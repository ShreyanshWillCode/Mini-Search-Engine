/**
 * suggestionService.js — Trie-backed autocomplete service
 * ─────────────────────────────────────────────────────────────────────────────
 * Singleton pattern: one Trie lives in memory for the lifetime of the server.
 *
 * Data sources (in priority order):
 *   1. InvertedIndex collection — every indexed word, frequency = doc count
 *   2. Live search queries       — boosted ×10 so searched terms surface first
 *
 * Thread safety note:
 *   Node.js is single-threaded, so concurrent reads during a rebuild are
 *   safe — the old Trie is fully replaced atomically via reference swap.
 */

"use strict";

const Trie           = require("./Trie");
const InvertedIndex  = require("../models/InvertedIndex");
const { tokenizeToArray } = require("../indexer/tokenizer");

// ── Singleton state ───────────────────────────────────────────────────────────
let trie       = new Trie();
let isBuilt    = false;
let isBuilding = false;
let wordCount  = 0;

// Search query frequency tracking (in-memory, complements Trie)
const queryFrequencyMap = new Map();

// ── Build / Rebuild ───────────────────────────────────────────────────────────

/**
 * buildTrie()
 * Loads all words from the InvertedIndex collection and inserts them
 * into a fresh Trie instance, then swaps the reference atomically.
 *
 * Should be called:
 *   1. On server startup (after DB connection is established)
 *   2. After every index rebuild (POST /api/index/rebuild)
 */
async function buildTrie() {
  if (isBuilding) {
    console.log("[Autocomplete] Build already in progress, skipping.");
    return;
  }

  isBuilding = true;
  console.log("[Autocomplete] Building Trie from InvertedIndex…");
  const start = Date.now();

  try {
    const newTrie  = new Trie();
    let   inserted = 0;

    // Stream all words from MongoDB using cursor to avoid loading all at once
    const cursor = InvertedIndex.find({}, { word: 1, documents: 1 })
      .lean()
      .cursor();

    for await (const entry of cursor) {
      if (!entry.word) continue;
      // Frequency = number of documents containing this word
      const freq = Array.isArray(entry.documents) ? entry.documents.length : 1;
      newTrie.insert(entry.word, freq);
      inserted++;
    }

    // Replay any previously tracked search queries into the new Trie
    for (const [word, freq] of queryFrequencyMap.entries()) {
      newTrie.insert(word, freq * 10); // 10× boost for searched terms
    }

    // Atomic reference swap
    trie      = newTrie;
    wordCount = inserted;
    isBuilt   = true;

    console.log(
      `[Autocomplete] Trie built in ${Date.now() - start}ms — ` +
      `${inserted} words, ${newTrie.size} unique nodes`
    );
  } catch (err) {
    console.error("[Autocomplete] Trie build failed:", err.message);
  } finally {
    isBuilding = false;
  }
}

// ── Query Tracking ────────────────────────────────────────────────────────────

/**
 * trackSearchQuery(queryString)
 * Called whenever a user performs a search. Tokenizes the query and inserts
 * each token into the live Trie with a ×10 frequency boost so popular
 * searches surface at the top of suggestions.
 *
 * @param {string} queryString
 */
function trackSearchQuery(queryString) {
  if (!queryString) return;
  const tokens = tokenizeToArray(queryString);
  for (const token of tokens) {
    // Track in the persistent map for Trie rebuilds
    queryFrequencyMap.set(token, (queryFrequencyMap.get(token) || 0) + 1);
    // Immediately boost in the live Trie
    trie.insert(token, 10);
  }
}

// ── Suggestion Retrieval ──────────────────────────────────────────────────────

/**
 * getSuggestions(prefix, limit)
 * Returns up to `limit` autocomplete suggestions for the given prefix.
 *
 * Falls back to an empty array if the Trie is not yet built (server cold-start
 * race condition — normally resolved within milliseconds of DB connect).
 *
 * @param {string} prefix
 * @param {number} [limit=8]
 * @returns {{ word: string, frequency: number }[]}
 */
function getSuggestions(prefix, limit = 8) {
  if (!prefix || !isBuilt) return [];
  prefix = prefix.trim().toLowerCase();
  if (prefix.length < 1) return [];

  // Get last token of multi-word prefix for Trie lookup
  const tokens   = prefix.split(/\s+/);
  const lastToken = tokens[tokens.length - 1];

  if (!lastToken) return [];
  return trie.getSuggestions(lastToken, limit);
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function getStats() {
  return {
    isBuilt,
    isBuilding,
    wordCount,
    trieSize:         trie.size,
    trackedQueries:   queryFrequencyMap.size,
  };
}

module.exports = { buildTrie, trackSearchQuery, getSuggestions, getStats };
