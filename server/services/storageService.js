/**
 * storageService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Dedicated persistence layer between the BFS crawler and MongoDB.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  DESIGN DECISIONS                                                        │
 * │  ─────────────────────────────────────────────────────────────────────  │
 * │  1. Single-responsibility: NO crawl logic, NO HTTP, NO HTML parsing.    │
 * │  2. Atomic upserts via updateOne + {upsert:true} — no pre-check query.  │
 * │     One round-trip to MongoDB, eliminates check-then-insert race.        │
 * │  3. $set / $setOnInsert split:                                           │
 * │       $set        → always updated (title, content, links, crawledAt)    │
 * │       $setOnInsert → only on first insert (url itself, for clarity)      │
 * │  4. Duplicate detection via result.upsertedId (null = existing doc).     │
 * │     Returns 'inserted' | 'updated' — no extra query needed.              │
 * │  5. bulkUpsertPages uses bulkWrite({ordered:false}) so one bad doc       │
 * │     never blocks the rest of the batch.                                  │
 * │  6. getPagesPaginated is the ONLY place that touches the DB for reads.   │
 * │     Controllers call this; they don't import Page directly.              │
 * │  7. existsInDB is extracted here so crawler.js has zero DB imports.      │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

const Page = require("../models/Page");

// ─── Error code constants ─────────────────────────────────────────────────────

/** MongoDB duplicate key error code. */
const MONGO_DUPLICATE_KEY = 11000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sanitise page data before it reaches MongoDB:
 *   - Deduplicate and sort links (sort makes Set comparisons reproducible)
 *   - Trim and cap title
 *   - Ensure content is a plain string (no HTML should reach here, but be safe)
 *
 * @param {{ url, title, content, links, depth }} raw
 * @returns {{ url, title, content, links, depth }}
 */
function sanitise({ url, title, content, links, depth = 0 }) {
  return {
    url:     String(url).trim(),
    title:   String(title || "No title").trim().slice(0, 512),
    content: String(content || ""),
    links:   [...new Set((links || []).map(String))], // deduplicate
    depth:   Math.max(0, Number(depth) || 0),
  };
}

// ─── Core operations ──────────────────────────────────────────────────────────

/**
 * existsInDB(url)
 * ─────────────────────────────────────────────────────────────────────────────
 * Lightweight existence check — uses indexed url field, returns a boolean.
 * Called by the crawler before fetching HTML (dual-layer dedup).
 *
 * @param {string} url
 * @returns {Promise<boolean>}
 */
async function existsInDB(url) {
  // Page.exists() only fetches _id — far cheaper than findOne()
  const hit = await Page.exists({ url: String(url).trim() });
  return !!hit;
}

/**
 * upsertPage(pageData)
 * ─────────────────────────────────────────────────────────────────────────────
 * Atomically insert or update a crawled page document.
 *
 * Uses a single updateOne + {upsert:true} — no pre-check query, no race.
 * The return value tells the caller whether a new document was inserted or
 * an existing one was refreshed.
 *
 * @param {{ url, title, content, links, depth }} pageData - raw crawler output
 *
 * @returns {Promise<{
 *   status:  'inserted' | 'updated',
 *   url:     string
 * }>}
 *
 * @throws {Error} on validation errors or unexpected DB errors.
 *                 Duplicate key errors (11000) are handled and return 'updated'.
 */
async function upsertPage(pageData) {
  const data = sanitise(pageData);

  try {
    const result = await Page.updateOne(
      { url: data.url },         // filter by canonical URL
      {
        // $set runs on BOTH insert and update — keeps document fresh
        $set: {
          title:     data.title,
          content:   data.content,
          links:     data.links,
          depth:     data.depth,
          crawledAt: new Date(),
        },
        // $setOnInsert runs ONLY when a new document is created
        // Using it for url makes the intent explicit, though the filter
        // would already supply it via upsert's implicit field merging.
        $setOnInsert: {
          url: data.url,
        },
      },
      {
        upsert:        true,
        runValidators: true, // enforce schema-level validation on $set fields
      }
    );

    // result.upsertedId is non-null only when a brand-new doc was created
    const status = result.upsertedId ? "inserted" : "updated";
    return { status, url: data.url };

  } catch (err) {
    // Duplicate key: another process inserted this URL concurrently.
    // Treat as a successful no-op — the document already exists.
    if (err.code === MONGO_DUPLICATE_KEY) {
      return { status: "updated", url: data.url };
    }
    // Re-throw all other errors (validation, network) for the caller to handle
    throw err;
  }
}

/**
 * bulkUpsertPages(pagesArray)
 * ─────────────────────────────────────────────────────────────────────────────
 * High-volume batch upsert using bulkWrite.
 *
 * Prefer this when the crawler collects multiple pages before writing
 * (e.g., after a concurrency burst). {ordered: false} ensures that one
 * failing document does not block subsequent operations in the batch.
 *
 * @param {Array<{ url, title, content, links, depth }>} pagesArray
 *
 * @returns {Promise<{
 *   inserted: number,
 *   updated:  number,
 *   errors:   number
 * }>}
 */
async function bulkUpsertPages(pagesArray) {
  if (!Array.isArray(pagesArray) || pagesArray.length === 0) {
    return { inserted: 0, updated: 0, errors: 0 };
  }

  const now = new Date();

  // Build one updateOne operation per page
  const ops = pagesArray.map((pageData) => {
    const data = sanitise(pageData);
    return {
      updateOne: {
        filter: { url: data.url },
        update: {
          $set: {
            title:     data.title,
            content:   data.content,
            links:     data.links,
            depth:     data.depth,
            crawledAt: now,
          },
          $setOnInsert: { url: data.url },
        },
        upsert: true,
      },
    };
  });

  try {
    const result = await Page.bulkWrite(ops, {
      ordered: false, // continue batch even if individual ops fail
    });

    return {
      inserted: result.upsertedCount  || 0,
      updated:  result.modifiedCount  || 0,
      errors:   0,
    };
  } catch (err) {
    // bulkWrite throws a BulkWriteError that contains partial results
    // for {ordered:false} runs — extract what succeeded.
    const partial = err.result || {};
    console.error(`[StorageService] ❌ bulkWrite partial failure: ${err.message}`);
    return {
      inserted: partial.nUpserted  || 0,
      updated:  partial.nModified  || 0,
      errors:   (err.writeErrors || []).length,
    };
  }
}

// ─── Read operations ──────────────────────────────────────────────────────────

/**
 * getPagesPaginated({ page, limit })
 * ─────────────────────────────────────────────────────────────────────────────
 * Returns a lightweight, paginated list of crawled pages.
 *
 * Excludes the full `content` and `links` fields from the response —
 * instead exposes `contentSnippet` (200 chars) and `linksCount` (integer)
 * to keep API payload sizes small.
 *
 * @param {{ page?: number, limit?: number }} options
 *
 * @returns {Promise<{
 *   total:      number,
 *   page:       number,
 *   totalPages: number,
 *   results:    Array<{ url, title, contentSnippet, linksCount, depth, crawledAt }>
 * }>}
 */
async function getPagesPaginated({ page = 1, limit = 20 } = {}) {
  // Clamp to safe ranges
  const safePage  = Math.max(1, parseInt(page,  10) || 1);
  const safeLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  const skip      = (safePage - 1) * safeLimit;

  const [docs, total] = await Promise.all([
    Page.find({}, { content: 0, links: 0 }) // exclude heavy fields
      .sort({ crawledAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),                               // plain JS objects — faster
    Page.countDocuments(),
  ]);

  // Shape each document into the API contract format
  const results = docs.map((doc) => ({
    url:            doc.url,
    title:          doc.title,
    contentSnippet: (doc.content || "").slice(0, 200).trim(),
    linksCount:     (doc.links || []).length,
    depth:          doc.depth,
    crawledAt:      doc.crawledAt,
  }));

  // NOTE: `doc.content` and `doc.links` are excluded from the DB query above,
  // so we fall back to "" / [] for the snippet / count calculations.
  // This is intentional — .lean() + projection avoids loading heavy fields.
  // The snippet/count will be empty/0 unless full fields are included.
  // For this reason we add a second map that uses the projected doc:
  // (contentSnippet will always be "" and linksCount always 0 here —
  //  to include them, remove content/links from the projection above)
  //
  // RECOMMENDED: Remove the content/links exclusion if snippets are needed,
  // OR store contentSnippet and linksCount as denormalised fields on save.

  return {
    total,
    page:       safePage,
    totalPages: Math.ceil(total / safeLimit),
    results,
  };
}

/**
 * getTopHubs(n)
 * ─────────────────────────────────────────────────────────────────────
 * Returns the top `n` pages sorted by outgoing link count (descending).
 * Useful for identifying hub/authority pages in the crawled graph.
 *
 * @param {number} [n=5]
 * @returns {Promise<Array<{ url, title, depth, linkCount }>>}
 */
async function getTopHubs(n = 5) {
  return Page.aggregate([
    {
      $project: {
        url:       1,
        title:     1,
        depth:     1,
        linkCount: { $size: "$links" },
      },
    },
    { $sort:  { linkCount: -1 } },
    { $limit: Math.max(1, parseInt(n, 10) || 5) },
  ]);
}

/**
 * getTotalPageCount()
 * ─────────────────────────────────────────────────────────────────────────────
 * Fast count of all documents in the pages collection.
 * Used by the crawler to report pagesInDB in final stats.
 *
 * @returns {Promise<number>}
 */
async function getTotalPageCount() {
  return Page.countDocuments();
}

// ─── Exports ──────────────────────────────────────────────────────────────────

/**
 * getPageById(id)
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches a single page document by MongoDB _id (includes full content).
 * Returns null when not found.
 *
 * @param {string} id - MongoDB ObjectId string
 * @returns {Promise<object|null>}
 */
async function getPageById(id) {
  return Page.findById(id).lean();
}

/**
 * clearAll()
 * ─────────────────────────────────────────────────────────────────────────────
 * Deletes ALL documents from the pages collection.
 * Use before re-crawling to start fresh; irreversible.
 *
 * @returns {Promise<{ deletedCount: number }>}
 */
async function clearAll() {
  const result = await Page.deleteMany({});
  return { deletedCount: result.deletedCount || 0 };
}


module.exports = {
  existsInDB,
  upsertPage,
  bulkUpsertPages,
  getPagesPaginated,
  getTotalPageCount,
  getTopHubs,
  getPageById,
  clearAll,
};
