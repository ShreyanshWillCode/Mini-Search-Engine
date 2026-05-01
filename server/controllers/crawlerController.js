/**
 * crawlerController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Express controller for the /crawl endpoint.
 * Validates all incoming request parameters and delegates to the BFS crawler.
 *
 * Imports from crawler.js (modular, production-ready version).
 */

const validUrl = require("valid-url");
const { runCrawler } = require("../crawler/crawler"); // ← updated import
const Page = require("../models/Page");

// ─── POST /api/crawl ──────────────────────────────────────────────────────────

/**
 * Start a new BFS crawl job.
 *
 * Request body:
 *   {
 *     seedURL:    string   (required) — starting URL
 *     maxDepth:   number   (optional, default 2, max 5)
 *     maxPages:   number   (optional, default 50, max 200)
 *     delayMs:    number   (optional, default 200ms — polite crawl delay)
 *     sameDomain: boolean  (optional, default false — stay on seed's domain)
 *   }
 *
 * Response (200):
 *   {
 *     pagesCrawled: number,
 *     status:       "completed",
 *     stats: {
 *       failed, skipped, pagesInDB, duration, durationSec
 *     }
 *   }
 */
exports.startCrawl = async (req, res) => {
  try {
    let { seedURL, maxDepth, maxPages, delayMs, sameDomain } = req.body;

    // ── Input validation ──────────────────────────────────────────────────
    if (!seedURL || typeof seedURL !== "string") {
      return res.status(400).json({
        success: false,
        error: "seedURL is required and must be a string.",
      });
    }

    seedURL = seedURL.trim();

    if (!validUrl.isWebUri(seedURL)) {
      return res.status(400).json({
        success: false,
        error: `"${seedURL}" is not a valid HTTP/HTTPS URL.`,
      });
    }

    // Clamp depth: 1–5 (default 2)
    maxDepth = parseInt(maxDepth, 10);
    if (isNaN(maxDepth) || maxDepth < 1) maxDepth = 2;
    if (maxDepth > 5) maxDepth = 5;

    // Clamp pages: 1–200 (default 50)
    maxPages = parseInt(maxPages, 10);
    if (isNaN(maxPages) || maxPages < 1) maxPages = 50;
    if (maxPages > 200) maxPages = 200;

    // Clamp delay: 0–5000ms (default 200)
    delayMs = parseInt(delayMs, 10);
    if (isNaN(delayMs) || delayMs < 0) delayMs = 200;
    if (delayMs > 5_000) delayMs = 5_000;

    // Boolean: stay on the seed URL's domain
    sameDomain = sameDomain === true || sameDomain === "true";

    console.log(
      `[API] 🕷️  POST /api/crawl | seed=${seedURL} | depth=${maxDepth} | pages=${maxPages} | delay=${delayMs}ms | sameDomain=${sameDomain}`
    );

    // ── Run the BFS crawler ───────────────────────────────────────────────
    const result = await runCrawler({ seedURL, maxDepth, maxPages, delayMs, sameDomain });

    // ── Response — matches spec: { pagesCrawled, status } ─────────────────
    return res.status(200).json({
      pagesCrawled: result.pagesCrawled,
      status:       result.status,
      stats: {
        failed:      result.failed,
        skipped:     result.skipped,
        pagesInDB:   result.pagesInDB,
        duration:    result.duration,
        // +(...) coerces toFixed's string → number. Guard keeps 0 if duration is undefined.
        durationSec: result.duration != null ? +(result.duration / 1000).toFixed(2) : 0,
      },
    });
  } catch (err) {
    console.error("[API] Crawler error:", err.message);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error",
    });
  }
};

// ─── GET /api/crawl/pages ─────────────────────────────────────────────────────

/**
 * Return a paginated list of all crawled pages from MongoDB.
 * Excludes the heavy `content` field for performance.
 *
 * Query params:
 *   ?page=1&limit=20
 */
exports.getPages = async (req, res) => {
  try {
    let page  = parseInt(req.query.page,  10) || 1;
    let limit = parseInt(req.query.limit, 10) || 20;
    if (limit > 100) limit = 100;
    const skip = (page - 1) * limit;

    const [pages, total] = await Promise.all([
      Page.find({}, { content: 0 })   // exclude heavy content field
        .sort({ crawledAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Page.countDocuments(),
    ]);

    return res.status(200).json({
      success: true,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      pages,
    });
  } catch (err) {
    console.error("[API] getPages error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ─── GET /api/crawl/pages/:id ─────────────────────────────────────────────────

/**
 * Fetch the full document (including content) of a single crawled page.
 */
exports.getPageById = async (req, res) => {
  try {
    const page = await Page.findById(req.params.id).lean();
    if (!page) {
      return res.status(404).json({ success: false, error: "Page not found." });
    }
    return res.status(200).json({ success: true, page });
  } catch (err) {
    console.error("[API] getPageById error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ─── DELETE /api/crawl/pages ──────────────────────────────────────────────────

/**
 * Clear ALL crawled pages from MongoDB.
 * Use before starting a fresh crawl to avoid stale data.
 */
exports.clearPages = async (req, res) => {
  try {
    const { deletedCount } = await Page.deleteMany({});
    console.log(`[API] Cleared ${deletedCount} page(s) from DB`);
    return res.status(200).json({
      success: true,
      message: `Deleted ${deletedCount} page(s) from the database.`,
    });
  } catch (err) {
    console.error("[API] clearPages error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ─── GET /api/crawl/stats ─────────────────────────────────────────────────────

/**
 * Quick database statistics — no new crawl is triggered.
 * Returns total pages + the top 5 "hub" pages by outgoing link count.
 */
exports.getStats = async (req, res) => {
  try {
    const [totalPages, topLinked] = await Promise.all([
      Page.countDocuments(),
      Page.aggregate([
        {
          $project: {
            url: 1,
            title: 1,
            depth: 1,
            linkCount: { $size: "$links" },
          },
        },
        { $sort: { linkCount: -1 } },
        { $limit: 5 },
      ]),
    ]);

    return res.status(200).json({
      success: true,
      stats: { totalPages, topLinked },
    });
  } catch (err) {
    console.error("[API] getStats error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};
