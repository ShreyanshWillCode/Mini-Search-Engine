/**
 * indexBuilder.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds and maintains the inverted index in MongoDB.
 *
 * Exports:
 *   indexDocument(page)         — incremental: index ONE page (delegates to indexBatch)
 *   indexBatch(pages)           — index N pages in ONE bulkWrite round-trip
 *   indexAllDocuments()         — full rebuild: wipe + re-index all Page docs
 *
 * DSA Notes:
 *   - In-memory frequency map: Map<word, frequency>  (HashMap)
 *       • Insertion: O(1) amortised average
 *       • Lookup:    O(1) average
 *   - Persistence: one bulkWrite per BATCH — M words across N pages = M ops in 1 call
 *   - Atomic add-or-update: MongoDB 4.2+ aggregation pipeline update
 *       • If docId already in posting list → update frequency in-place
 *       • If docId not present            → $concatArrays with new posting
 *       • If word not in collection       → upsert creates it
 *
 * Called by:
 *   - indexQueue.js      (indexBatch — batch of N pages from queue)
 *   - searchRoutes.js    (indexAllDocuments — admin rebuild endpoint)
 *   - (crawler no longer calls this directly — the queue handles it)
 */

"use strict";

const InvertedIndex = require("../models/InvertedIndex");
const Page          = require("../models/Page");
const { tokenize }  = require("./tokenizer");

// ── Constants ─────────────────────────────────────────────────────────────────

/** Title tokens count 3× — mirrors the Page text-index weight (title: 10). */
const TITLE_BOOST = 3;

/** Per-document token cap — guards against pathological huge pages. */
const MAX_TOKENS_PER_DOC = 500;

/** Batch size for the full-rebuild loop (memory-safe). */
const REBUILD_BATCH_SIZE = 20;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * buildFreqMap(page)
 * Returns a Map<word, frequency> merging boosted title tokens + content tokens.
 * Uses HashMap (Map) for O(1) average insert and lookup during merge.
 */
function buildFreqMap(page) {
  const combined = new Map(tokenize(page.content || ""));

  for (const [word, count] of tokenize(page.title || "")) {
    combined.set(word, (combined.get(word) || 0) + count * TITLE_BOOST);
  }

  if (combined.size <= MAX_TOKENS_PER_DOC) return combined;

  // Over cap — keep highest-frequency words
  return new Map(
    [...combined.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_TOKENS_PER_DOC)
  );
}

/**
 * buildOpsForPage(page)
 * Converts one page document into an array of MongoDB bulkWrite operations.
 *
 * Each op is an aggregation-pipeline updateOne that atomically:
 *   - Creates a word entry if it doesn't exist (upsert)
 *   - Updates the posting in-place if this docId is already there (idempotent)
 *   - Appends a new posting if this docId is new to the word
 *
 * Multiple ops for the same word from different pages are safe in a single
 * bulkWrite because each targets a different docId inside the documents array.
 */
function buildOpsForPage(page) {
  const docId   = String(page._id || page.docId || "");
  const url     = page.url   || "";
  const title   = page.title || "No title";
  const freqMap = buildFreqMap(page);
  const ops     = [];

  for (const [word, frequency] of freqMap) {
    const newPosting = { docId, url, title, frequency };

    ops.push({
      updateOne: {
        filter: { word },
        update: [
          {
            $set: {
              word: { $ifNull: ["$word", word] },

              // ── Set semantics via aggregation pipeline $cond ──────────────
              //
              //  Check: is this docId already in the posting list?
              //    YES → replace the matching entry in-place (idempotent update)
              //    NO  → append a brand-new posting ($concatArrays)
              //
              //  Result: each (word, docId) pair is unique — Set semantics.
              //
              documents: {
                $cond: {
                  if: {
                    $in: [
                      docId,
                      {
                        $map: {
                          input: { $ifNull: ["$documents", []] },
                          as:    "d",
                          in:    "$$d.docId",
                        },
                      },
                    ],
                  },
                  then: {
                    $map: {
                      input: { $ifNull: ["$documents", []] },
                      as:    "d",
                      in: {
                        $cond: {
                          if:   { $eq: ["$$d.docId", docId] },
                          then: newPosting,
                          else: "$$d",
                        },
                      },
                    },
                  },
                  else: {
                    $concatArrays: [{ $ifNull: ["$documents", []] }, [newPosting]],
                  },
                },
              },
            },
          },
        ],
        upsert: true,
      },
    });
  }

  return ops;
}

// ── Core exports ──────────────────────────────────────────────────────────────

/**
 * indexBatch(pages)
 * ─────────────────────────────────────────────────────────────────────────────
 * Indexes N pages in a SINGLE bulkWrite round-trip to MongoDB.
 *
 * Performance vs. N × indexDocument():
 *   N pages × ~200 words each → 200N ops in 1 bulkWrite (1 TCP round-trip)
 *   vs. N separate bulkWrites (N round-trips)
 *
 * This is the primary write path used by the hybrid queue.
 *
 * @param {Array<{ _id|docId, url, title, content }>} pages
 * @returns {Promise<{ pagesIndexed: number, wordsIndexed: number }>}
 */
async function indexBatch(pages) {
  if (!Array.isArray(pages) || pages.length === 0) {
    return { pagesIndexed: 0, wordsIndexed: 0 };
  }

  // Collect bulkWrite ops from all pages.
  // Multiple ops targeting the same word (different docIds) are valid
  // because each modifies a different element in the documents array.
  const allOps = [];
  for (const page of pages) {
    for (const op of buildOpsForPage(page)) allOps.push(op);
  }

  if (allOps.length === 0) return { pagesIndexed: pages.length, wordsIndexed: 0 };

  // One network round-trip for the entire batch.
  // ordered:false → one failing word never blocks the rest.
  await InvertedIndex.bulkWrite(allOps, { ordered: false });

  return { pagesIndexed: pages.length, wordsIndexed: allOps.length };
}

/**
 * indexDocument(page)
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin wrapper — indexes exactly one page via indexBatch([page]).
 * Kept for API compatibility; the queue uses indexBatch directly.
 *
 * @param {{ _id, url, title, content }} page
 * @returns {Promise<{ wordsIndexed: number }>}
 */
async function indexDocument(page) {
  const { wordsIndexed } = await indexBatch([page]);
  return { wordsIndexed };
}

/**
 * indexAllDocuments()
 * ─────────────────────────────────────────────────────────────────────────────
 * Full index rebuild. Wipes InvertedIndex and re-indexes every Page.
 * Memory-safe: paginates in batches; each batch = one bulkWrite call.
 *
 * Triggered via: POST /api/index/rebuild
 *
 * @returns {Promise<{ docsProcessed: number, wordsIndexed: number }>}
 */
async function indexAllDocuments() {
  await InvertedIndex.deleteMany({});

  let docsProcessed = 0;
  let wordsIndexed  = 0;
  let batchPage     = 0;

  while (true) {
    const docs = await Page.find({})
      .select("_id url title content")
      .skip(batchPage * REBUILD_BATCH_SIZE)
      .limit(REBUILD_BATCH_SIZE)
      .lean();

    if (docs.length === 0) break;

    const result  = await indexBatch(docs);
    wordsIndexed  += result.wordsIndexed;
    docsProcessed += docs.length;

    batchPage++;
    if (docs.length < REBUILD_BATCH_SIZE) break;
  }

  return { docsProcessed, wordsIndexed };
}

module.exports = { indexDocument, indexBatch, indexAllDocuments };
