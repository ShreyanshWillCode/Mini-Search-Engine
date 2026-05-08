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

const InvertedIndex       = require("../models/InvertedIndex");
const Page                = require("../models/Page");
const { tokenizeToArray } = require("../indexer/tokenizer");
const cache               = require("../cache/cacheManager");

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
async function search(queryString, { limit = 10, page = 1, strategy = "union", alpha = 0.7, beta = 0.3 } = {}) {
  const t0     = Date.now();
  const tokens = tokenizeToArray(queryString);

  if (tokens.length === 0) {
    return { query: queryString, tokens: [], strategy, total: 0, page, results: [], fromCache: false, latencyMs: 0 };
  }

  // ── 0. Cache lookup ─────────────────────────────────────────────────────────
  //
  // Cache key encodes every parameter that can affect the result set.
  //
  const cacheKey = `${queryString.toLowerCase()}|${strategy}|a${alpha}|b${beta}|p${page}|l${limit}`;
  const cached   = await cache.get("search", cacheKey);
  if (cached) {
    return { ...cached, fromCache: true, latencyMs: Date.now() - t0 };
  }

  // ── 1. Fetch total doc count & posting lists concurrently ──────────────────
  //
  //  N = Total documents in corpus (for IDF calculation)
  //
  const [totalDocs, ...postingLists] = await Promise.all([
    Page.countDocuments(),
    ...tokens.map((token) =>
      InvertedIndex.findOne({ word: token }, { documents: 1, _id: 0 }).lean()
    ),
  ]);

  // Handle empty corpus edge case
  const N = totalDocs || 1;

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

    // IDF = log10(Total Docs / Docs containing this word)
    const df  = postingList.documents.length;
    const idf = Math.log10(N / df);

    for (const posting of postingList.documents) {
      const { docId, url, title, frequency } = posting;
      const tfIdfScore = frequency * idf;

      if (scoreMap.has(docId)) {
        const entry = scoreMap.get(docId);
        entry.score         += tfIdfScore;
        entry.matchedTokens += 1;
      } else {
        scoreMap.set(docId, {
          docId,
          url,
          title,
          score:         tfIdfScore,
          matchedTokens: 1,
        });
      }
    }
  }

  // ── 3. Apply merge strategy ─────────────────────────────────────────────────

  let candidates = [...scoreMap.values()];

  if (strategy === "intersection") {
    candidates = candidates.filter(
      (entry) => entry.matchedTokens === tokens.length
    );
  }

  // ── 3.5. Integrate PageRank ─────────────────────────────────────────────────

  if (candidates.length > 0) {
    const candidateIds = candidates.map((c) => c.docId);
    const pagesData    = await Page
      .find({ _id: { $in: candidateIds } }, { pagerank: 1 })
      .lean();

    const prMap = new Map();
    for (const p of pagesData) {
      prMap.set(p._id.toString(), p.pagerank || 0);
    }

    let maxTfIdf = 0;
    for (const c of candidates) {
      if (c.score > maxTfIdf) maxTfIdf = c.score;
    }

    for (const c of candidates) {
      const pr              = prMap.get(c.docId) || 0;
      const normalizedTfIdf = maxTfIdf > 0 ? c.score / maxTfIdf : 0;
      const scaledPr        = pr * N;
      c.score = (alpha * normalizedTfIdf) + (beta * scaledPr);
    }
  }

  // ── 4. Sort by score descending, paginate ──────────────────────────────────

  candidates.sort((a, b) => b.score - a.score);

  const startIndex    = (page - 1) * limit;
  const topCandidates = candidates.slice(startIndex, startIndex + limit);

  // ── 5. Enrichment: Snippets & Highlighting (BATCHED) ────────────────────────
  //
  // OPTIMIZATION: One single Page.find({ $in: ids }) replaces N sequential
  // Page.findById() calls — reduces DB round-trips from O(N) to O(1).
  //
  const topIds      = topCandidates.map((c) => c.docId);
  const contentDocs = await Page
    .find({ _id: { $in: topIds } }, { content: 1 })
    .lean();

  const contentMap = new Map();
  for (const doc of contentDocs) {
    contentMap.set(doc._id.toString(), doc.content || "");
  }

  const enrichedResults = topCandidates.map((candidate) => {
    const content = contentMap.get(candidate.docId) || "";
    const snippet = generateHighlightedSnippet(content, tokens);
    return {
      url:     candidate.url,
      title:   candidate.title,
      score:   +(candidate.score.toFixed(4)),
      snippet,
    };
  });

  const result = {
    query:      queryString,
    tokens,
    strategy,
    total:      candidates.length,
    page,
    totalPages: Math.ceil(candidates.length / limit),
    results:    enrichedResults,
    fromCache:  false,
    latencyMs:  Date.now() - t0,
  };

  // ── 6. Store in Redis cache ─────────────────────────────────────────────────
  await cache.set("search", cacheKey, result);

  return result;
}

/**
 * generateHighlightedSnippet(content, queryTokens)
 * ─────────────────────────────────────────────────────────────────────────────
 * Finds a relevant window of text around the first matching query token.
 * Wraps matched tokens in <b> tags.
 */
function generateHighlightedSnippet(content, queryTokens) {
  if (!content) return "";

  const windowSize = 160;
  let firstMatchIdx = -1;
  let foundToken = "";

  // Find the first occurrence of any query token
  const contentLower = content.toLowerCase();
  for (const token of queryTokens) {
    const idx = contentLower.indexOf(token.toLowerCase());
    if (idx !== -1 && (firstMatchIdx === -1 || idx < firstMatchIdx)) {
      firstMatchIdx = idx;
      foundToken = token;
    }
  }

  // If no match found (rare if it's in the index), just return start
  if (firstMatchIdx === -1) {
    return content.slice(0, windowSize) + "...";
  }

  // Determine start/end of snippet window
  let start = Math.max(0, firstMatchIdx - 60);
  let end = Math.min(content.length, start + windowSize);

  // Adjust start to not break words if possible
  if (start > 0) {
    const firstSpace = content.indexOf(" ", start);
    if (firstSpace !== -1 && firstSpace < firstMatchIdx) {
      start = firstSpace + 1;
    }
  }

  let snippet = content.slice(start, end);
  if (start > 0) snippet = "..." + snippet;
  if (end < content.length) snippet = snippet + "...";

  // Highlight all tokens in the snippet
  // Use regex with 'gi' (global, case-insensitive)
  let highlighted = snippet;
  for (const token of queryTokens) {
    // Escape regex special chars in token
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(${escaped})`, "gi");
    highlighted = highlighted.replace(re, "<b>$1</b>");
  }

  return highlighted;
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
