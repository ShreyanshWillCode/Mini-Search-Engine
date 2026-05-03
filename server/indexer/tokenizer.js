/**
 * tokenizer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure text tokenization pipeline used by BOTH the indexer AND the search API.
 *
 * Using the SAME tokenizer in both places is critical for correctness:
 * a query for "running" must match pages indexed with "running", not "run".
 *
 * DESIGN — HashMap (JavaScript Map):
 *   Map<word, frequency>
 *   - Insertion: O(1) amortised average
 *   - Lookup:    O(1) average
 *   - No prototype-chain collision risk (unlike plain Object keys)
 *   - Iteration order is insertion order (deterministic)
 *
 * This module is intentionally pure:
 *   - No I/O, no DB, no side-effects
 *   - Input: string → Output: Map<string, number>
 *   - Easy to unit-test in isolation
 */

"use strict";

const { STOPWORDS } = require("./stopwords");

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_LEN = 2;   // ignore single-character tokens
const MAX_LEN = 50;  // ignore suspiciously long strings (URLs leaking in, etc.)

// ── Core export ───────────────────────────────────────────────────────────────

/**
 * tokenize(text)
 * ─────────────────────────────────────────────────────────────────────────────
 * Converts raw text into a word-frequency HashMap.
 *
 * Pipeline (in order):
 *   1. Guard — return empty Map for non-string / empty input
 *   2. Lowercase              ("Hello World" → "hello world")
 *   3. Strip non-alphanumeric (keep internal hyphens for compound words)
 *   4. Split on whitespace
 *   5. For each token:
 *        a. Expand hyphenated forms ("state-of-art" → ["state-of-art","state","of","art"])
 *        b. Filter: length, stopword list, must contain at least one letter
 *        c. Increment frequency counter in HashMap — O(1) avg
 *
 * @param   {string} text
 * @returns {Map<string, number>}  word → frequency
 */
function tokenize(text) {
  // Step 1 — guard
  if (!text || typeof text !== "string") return new Map();

  // Step 2 — lowercase
  const lower = text.toLowerCase();

  // Step 3 — clean: keep a-z, 0-9, whitespace, internal hyphens
  //   Replace anything else with a space.
  //   Then normalise multiple spaces.
  const cleaned = lower
    .replace(/[^a-z0-9\s-]/g, " ")   // strip punctuation / special chars
    .replace(/\s*-\s*/g, "-")          // normalise hyphen spacing
    .replace(/-{2,}/g, " ")            // collapse repeated hyphens
    .trim();

  if (!cleaned) return new Map();

  // Step 4 — split on whitespace
  const rawTokens = cleaned.split(/\s+/);

  // Step 5 — filter + count
  //
  //  Using Map (HashMap) for the frequency table:
  //    freqMap.set(word, count)  → O(1) amortised
  //    freqMap.get(word)         → O(1)
  //  This is equivalent to the traditional inverted-index hash table where
  //  each word maps to a posting list.  Here it maps to a local frequency.
  //
  const freqMap = new Map();

  for (const raw of rawTokens) {
    if (!raw) continue;

    // Expand hyphenated compound words so we index both the compound and
    // each component: "state-of-art" → ["state-of-art", "state", "art"]
    const candidates = raw.includes("-")
      ? [raw, ...raw.split("-")]
      : [raw];

    for (const word of candidates) {
      if (
        word.length >= MIN_LEN &&
        word.length <= MAX_LEN &&
        /[a-z]/.test(word) &&         // must contain at least one letter
        !STOPWORDS.has(word)           // O(1) Set lookup
      ) {
        freqMap.set(word, (freqMap.get(word) || 0) + 1);
      }
    }
  }

  return freqMap;
}

/**
 * tokenizeToArray(text)
 * ─────────────────────────────────────────────────────────────────────────────
 * Convenience wrapper — returns the unique token list (no frequencies).
 * Used by the search service when only token presence matters.
 *
 * @param   {string} text
 * @returns {string[]}
 */
function tokenizeToArray(text) {
  return [...tokenize(text).keys()];
}

module.exports = { tokenize, tokenizeToArray };
