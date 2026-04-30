/**
 * crawlerRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * All routes are mounted under /api/crawl (see index.js).
 *
 * POST   /api/crawl             – Start a new crawl job
 * GET    /api/crawl/pages       – List all crawled pages (paginated)
 * GET    /api/crawl/pages/:id   – Get a single crawled page by ID
 * DELETE /api/crawl/pages       – Clear all crawled pages
 * GET    /api/crawl/stats       – Quick DB statistics
 */

const express = require("express");
const router = express.Router();

const {
  startCrawl,
  getPages,
  getPageById,
  clearPages,
  getStats,
} = require("../controllers/crawlerController");

// Crawl trigger
router.post("/", startCrawl);

// Stats (before /:id so it doesn't match as an id)
router.get("/stats", getStats);

// Pages collection
router.route("/pages").get(getPages).delete(clearPages);

// Single page
router.get("/pages/:id", getPageById);

module.exports = router;
