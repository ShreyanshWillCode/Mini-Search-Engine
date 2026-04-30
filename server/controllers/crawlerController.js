/**
 * crawlerController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Express controller for the /crawl endpoint.
 * Validates input, delegates to the BFS crawler, and returns statistics.
 */

const validUrl = require("valid-url");
const { runCrawler } = require("../crawler/bfsCrawler");
const Page = require("../models/Page");

// ─── POST /crawl ──────────────────────────────────────────────────────────────

/**
 * Start a new crawl job.
 *
 * Request body:
 *   { seedURL: string, maxDepth?: number, maxPages?: number }
 *
 * Response (200):
 *   {
 *     success: true,
 *     message: string,
 *     stats: { crawled, failed, skipped, pagesInDB, durationMs, durationSec }
 *   }
 */
exports.startCrawl = async (req, res) => {
  try {
    let { seedURL, maxDepth, maxPages } = req.body;

    // ── Input validation ───────────────────────────────────────────────────
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

    // Clamp depth: 1–5
    maxDepth = parseInt(maxDepth, 10);
    if (isNaN(maxDepth) || maxDepth < 1) maxDepth = 2;
    if (maxDepth > 5) maxDepth = 5;

    // Clamp pages: 1–200
    maxPages = parseInt(maxPages, 10);
    if (isNaN(maxPages) || maxPages < 1) maxPages = 50;
    if (maxPages > 200) maxPages = 200;

    console.log(
      `🕷️  Crawl started | seed=${seedURL} | maxDepth=${maxDepth} | maxPages=${maxPages}`
    );

    // ── Run crawler ────────────────────────────────────────────────────────
    const stats = await runCrawler({ seedURL, maxDepth, maxPages });

    return res.status(200).json({
      success: true,
      message: `Crawl complete. Visited ${stats.crawled} page(s) starting from "${seedURL}".`,
      stats: {
        ...stats,
        durationSec: (stats.duration / 1000).toFixed(2),
      },
    });
  } catch (err) {
    console.error("Crawler error:", err.message);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error",
    });
  }
};

// ─── GET /crawl/pages ─────────────────────────────────────────────────────────

/**
 * Return paginated list of crawled pages stored in MongoDB.
 *
 * Query params:
 *   page  (default 1)
 *   limit (default 20, max 100)
 */
exports.getPages = async (req, res) => {
  try {
    let page = parseInt(req.query.page, 10) || 1;
    let limit = parseInt(req.query.limit, 10) || 20;
    if (limit > 100) limit = 100;
    const skip = (page - 1) * limit;

    const [pages, total] = await Promise.all([
      Page.find({}, { content: 0 }) // exclude heavy content field
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
    console.error("getPages error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ─── GET /crawl/pages/:id ─────────────────────────────────────────────────────

/**
 * Fetch full details (including content) of a single crawled page by Mongo _id.
 */
exports.getPageById = async (req, res) => {
  try {
    const page = await Page.findById(req.params.id).lean();
    if (!page) {
      return res
        .status(404)
        .json({ success: false, error: "Page not found." });
    }
    return res.status(200).json({ success: true, page });
  } catch (err) {
    console.error("getPageById error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ─── DELETE /crawl/pages ──────────────────────────────────────────────────────

/**
 * Clear all crawled pages from the database.
 * Useful when starting a fresh crawl.
 */
exports.clearPages = async (req, res) => {
  try {
    const { deletedCount } = await Page.deleteMany({});
    return res.status(200).json({
      success: true,
      message: `Deleted ${deletedCount} page(s) from the database.`,
    });
  } catch (err) {
    console.error("clearPages error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ─── GET /crawl/stats ─────────────────────────────────────────────────────────

/**
 * Quick database statistics without running a new crawl.
 */
exports.getStats = async (req, res) => {
  try {
    const [totalPages, topLinked] = await Promise.all([
      Page.countDocuments(),
      // Pages with the most outgoing links (proxy for "hub" pages)
      Page.aggregate([
        { $project: { url: 1, linkCount: { $size: "$links" }, depth: 1 } },
        { $sort: { linkCount: -1 } },
        { $limit: 5 },
      ]),
    ]);

    return res.status(200).json({
      success: true,
      stats: { totalPages, topLinked },
    });
  } catch (err) {
    console.error("getStats error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};
