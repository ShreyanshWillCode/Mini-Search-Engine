/**
 * crawlController.js
 *
 * Handles:
 *  POST /api/crawl          — Start a new crawl job
 *  GET  /api/crawl/:session — Get all pages from a crawl session
 *  GET  /api/pages          — Paginated list of all crawled pages
 *  GET  /api/stats          — Overall database statistics
 *  DELETE /api/crawl/:session — Delete a crawl session's data
 */

const { crawl } = require("../crawler/crawler");
const Page = require("../models/Page");
const validUrl = require("valid-url");
const crypto = require("crypto");

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Generates a short unique session ID for grouping crawl results.
 * Format: "sess_<8 hex chars>"
 */
const generateSessionId = () =>
  "sess_" + crypto.randomBytes(4).toString("hex");

// ─── POST /api/crawl ───────────────────────────────────────────────────────────
/**
 * Triggers a BFS web crawl from a given seed URL.
 *
 * Request body:
 *   {
 *     seedURL  : string   — Required. Must be a valid http/https URL.
 *     maxDepth : number   — Optional. BFS depth limit. Default: 3, Max: 10.
 *     maxPages : number   — Optional. Total page cap. Default: 50, Max: 200.
 *   }
 *
 * Returns a crawl statistics summary + the first 20 crawled pages.
 */
const startCrawl = async (req, res) => {
  const { seedURL, maxDepth = 3, maxPages = 50 } = req.body;

  // ── Input Validation ───────────────────────────────────────────────────────
  if (!seedURL) {
    return res.status(400).json({
      success: false,
      message: "seedURL is required",
    });
  }

  if (!validUrl.isWebUri(seedURL)) {
    return res.status(400).json({
      success: false,
      message: "seedURL must be a valid http/https URL",
      example: "https://example.com",
    });
  }

  if (maxDepth < 0 || maxDepth > 10) {
    return res.status(400).json({
      success: false,
      message: "maxDepth must be between 0 and 10",
    });
  }

  if (maxPages < 1 || maxPages > 200) {
    return res.status(400).json({
      success: false,
      message: "maxPages must be between 1 and 200",
    });
  }

  const sessionId = generateSessionId();

  console.log(`\n📬 POST /api/crawl — session: ${sessionId}`);
  console.log(`   seedURL: ${seedURL} | maxDepth: ${maxDepth} | maxPages: ${maxPages}`);

  try {
    // Run the BFS crawl (synchronous within this request for simplicity;
    // for production use a job queue like Bull/BullMQ)
    const stats = await crawl({
      seedUrl: seedURL,
      maxDepth: parseInt(maxDepth),
      maxPages: parseInt(maxPages),
      sessionId,
    });

    // Fetch a preview of crawled pages (first 20)
    const pages = await Page.find({ crawlSessionId: sessionId })
      .select("url title depth links statusCode crawledAt")
      .sort({ depth: 1, crawledAt: 1 })
      .limit(20)
      .lean();

    return res.status(200).json({
      success: true,
      message: "Crawl completed successfully",
      stats,
      pages,
      meta: {
        sessionId,
        totalReturned: pages.length,
        fetchAllPages: `/api/crawl/${sessionId}`,
      },
    });
  } catch (err) {
    console.error("[startCrawl] Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Crawl failed due to an internal error",
      error: err.message,
    });
  }
};

// ─── GET /api/crawl/:sessionId ─────────────────────────────────────────────────
/**
 * Returns all pages from a specific crawl session with pagination.
 */
const getSessionPages = async (req, res) => {
  const { sessionId } = req.params;
  const page  = Math.max(parseInt(req.query.page)  || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const skip  = (page - 1) * limit;

  try {
    const [pages, total] = await Promise.all([
      Page.find({ crawlSessionId: sessionId })
        .sort({ depth: 1, crawledAt: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Page.countDocuments({ crawlSessionId: sessionId }),
    ]);

    if (total === 0) {
      return res.status(404).json({
        success: false,
        message: `No pages found for session: ${sessionId}`,
      });
    }

    return res.status(200).json({
      success: true,
      sessionId,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
      },
      pages,
    });
  } catch (err) {
    console.error("[getSessionPages] Error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ─── GET /api/pages ────────────────────────────────────────────────────────────
/**
 * Paginated list of all crawled pages across all sessions.
 * Supports ?search= for basic text filtering on URL/title.
 */
const getAllPages = async (req, res) => {
  const page    = Math.max(parseInt(req.query.page)   || 1, 1);
  const limit   = Math.min(parseInt(req.query.limit)  || 20, 100);
  const search  = req.query.search?.trim() || "";
  const skip    = (page - 1) * limit;

  try {
    // Build query — use text index if search term provided
    const query = search
      ? { $or: [
          { url:   { $regex: search, $options: "i" } },
          { title: { $regex: search, $options: "i" } },
        ]}
      : {};

    const [pages, total] = await Promise.all([
      Page.find(query)
        .select("url title depth crawlSessionId statusCode links crawledAt")
        .sort({ crawledAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Page.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
      },
      pages,
    });
  } catch (err) {
    console.error("[getAllPages] Error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ─── GET /api/stats ────────────────────────────────────────────────────────────
/**
 * Returns aggregate statistics across all crawl sessions.
 */
const getStats = async (req, res) => {
  try {
    const [
      totalPages,
      totalSessions,
      depthAgg,
      recentSessions,
    ] = await Promise.all([
      Page.countDocuments(),
      Page.distinct("crawlSessionId").then((ids) => ids.length),
      Page.aggregate([
        { $group: { _id: "$depth", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Page.aggregate([
        { $sort: { crawledAt: -1 } },
        { $group: {
          _id: "$crawlSessionId",
          pageCount: { $sum: 1 },
          firstUrl:  { $last: "$url" },
          crawledAt: { $last: "$crawledAt" },
          avgDepth:  { $avg: "$depth" },
          errorCount:{ $sum: { $cond: [{ $ne: ["$error", null] }, 1, 0] } },
        }},
        { $sort: { crawledAt: -1 } },
        { $limit: 10 },
      ]),
    ]);

    const depthDistribution = {};
    depthAgg.forEach(({ _id, count }) => {
      depthDistribution[`depth_${_id}`] = count;
    });

    return res.status(200).json({
      success: true,
      stats: {
        totalPages,
        totalSessions,
        depthDistribution,
        recentSessions,
      },
    });
  } catch (err) {
    console.error("[getStats] Error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ─── DELETE /api/crawl/:sessionId ─────────────────────────────────────────────
/**
 * Deletes all pages associated with a crawl session.
 * Useful for re-crawling or cleaning up test runs.
 */
const deleteSession = async (req, res) => {
  const { sessionId } = req.params;

  try {
    const result = await Page.deleteMany({ crawlSessionId: sessionId });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: `No pages found for session: ${sessionId}`,
      });
    }

    return res.status(200).json({
      success: true,
      message: `Deleted ${result.deletedCount} pages from session ${sessionId}`,
      deletedCount: result.deletedCount,
    });
  } catch (err) {
    console.error("[deleteSession] Error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

module.exports = {
  startCrawl,
  getSessionPages,
  getAllPages,
  getStats,
  deleteSession,
};
