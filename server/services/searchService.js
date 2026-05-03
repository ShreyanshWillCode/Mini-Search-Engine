/**
 * searchService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Query parsing, inverted index lookup, result merging, and scoring.
 *
 * Uses the SAME tokenizer as indexBuilder — this is intentional and critical:
 *   "web crawling" at search time must produce the same tokens as at index time.
 *
 * Result merging strategies:
 *   'union'        (default) — return docs that match ANY query token
 *   'intersection'           — return docs that match ALL query tokens
 *
 * Scoring (simple TF sum):
 *   score = Σ frequency(token, doc) for each matched token
 *   Higher score → word appears more often in that document → ranked higher.
 *   This is a simplified form of TF (term frequency) scoring.
 *   TF-IDF weighting can be added in Stage 3 by dividing by log(N/df)
 *   where N = total docs, df = number of docs containing the word.
 */

"use strict";

const InvertedIndex      = require("../models/InvertedIndex");
const { tokenizeToArray } = require("../indexer/tokenizer");

// ── Core export ───────────────────────────────────────────────────────────────

/**
 * search(queryString, options)
 * ─────────────────────────────────────────────────────────────────────────────
 * @param {string}  queryString          — raw query from user (e.g. "web crawling")
 * @param {object}  [options]
 * @param {number}  [options.limit=10]   — max results to return
 * @param {string}  [options.strategy]   — 'union' | 'intersection'
 *
 * @returns {Promise<{
 *   query:    string,
 *   tokens:   string[],
 *   strategy: string,
 *   total:    number,
 *   results:  Array<{ url, title, score }>
 * }>}
 */
async function search(queryString, { limit = 10, strategy = "union" } = {}) {
  const tokens = tokenizeToArray(queryString);

  if (tokens.length === 0) {
    return { query: queryString, tokens: [], strategy, total: 0, results: [] };
  }

  // ── 1. Fetch posting lists for each token ───────────────────────────────────
  //
  //  One DB query per token.  We project only the `documents` array — we don't
  //  need `word` or timestamps in the response.
  //
  //  Using Promise.all: all token lookups fire concurrently — faster than
  //  sequential awaits when query has multiple tokens.
  //
  const postingLists = await Promise.all(
    tokens.map((token) =>
      InvertedIndex.findOne({ word: token }, { documents: 1, _id: 0 }).lean()
    )
  );

  // ── 2. Build a score map:  docId → { url, title, score, matchedTokens } ────
  //
  //  Using a JavaScript Map (HashMap) for O(1) average insert + lookup:
  //    - Key:   docId (string)
  //    - Value: { url, title, score, matchedTokens }
  //
  //  This naturally handles union: any posted document accumulates score.
  //  Intersection is enforced as a post-filter step.
  //
  const scoreMap = new Map();   // HashMap: docId → result object

  for (let i = 0; i < tokens.length; i++) {
    const postingList = postingLists[i];
    if (!postingList || !postingList.documents) continue;

    for (const posting of postingList.documents) {
      const { docId, url, title, frequency } = posting;

      if (scoreMap.has(docId)) {
        // O(1) lookup — accumulate score and track matched token count
        const entry = scoreMap.get(docId);
        entry.score        += frequency;
        entry.matchedTokens += 1;
      } else {
        // O(1) insert — new document seen for the first time
        scoreMap.set(docId, {
          url,
          title,
          score:         frequency,
          matchedTokens: 1,
        });
      }
    }
  }

  // ── 3. Apply merge strategy ─────────────────────────────────────────────────

  let candidates = [...scoreMap.values()];

  if (strategy === "intersection") {
    // Keep only docs that matched every token
    candidates = candidates.filter(
      (entry) => entry.matchedTokens === tokens.length
    );
  }

  // ── 4. Sort by score descending, slice to limit ─────────────────────────────

  candidates.sort((a, b) => b.score - a.score);
  const results = candidates.slice(0, Math.max(1, parseInt(limit, 10) || 10));

  // Clean up internal fields before returning
  const clean = results.map(({ url, title, score }) => ({ url, title, score }));

  return {
    query:    queryString,
    tokens,
    strategy,
    total:    candidates.length,
    results:  clean,
  };
}

/**
 * getIndexStats()
 * ─────────────────────────────────────────────────────────────────────────────
 * Returns quick statistics about the current inverted index.
 * Used by GET /api/index/stats.
 *
 * @returns {Promise<{ totalWords, totalPostings, topWords }>}
 */
async function getIndexStats() {
  const [totalWords, topWords] = await Promise.all([
    InvertedIndex.countDocuments(),
    InvertedIndex.aggregate([
      {
        $project: {
          word:          1,
          postingCount:  { $size: "$documents" },
        },
      },
      { $sort:  { postingCount: -1 } },
      { $limit: 10 },
    ]),
  ]);

  const totalPostings = topWords.reduce((sum, w) => sum + w.postingCount, 0);

  return { totalWords, totalPostings, topWords };
}

module.exports = { search, getIndexStats };
