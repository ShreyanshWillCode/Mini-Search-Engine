const express = require("express");
const router = express.Router();
const {
  startCrawl,
  getSessionPages,
  getAllPages,
  getStats,
  deleteSession,
} = require("../controllers/crawlController");

// ── Crawl Operations ──────────────────────────────────────────────────────────
router.post("/crawl", startCrawl);                       // Start a new BFS crawl
router.get("/crawl/:sessionId", getSessionPages);        // Get pages for a session
router.delete("/crawl/:sessionId", deleteSession);       // Delete a session

// ── Page Browsing ─────────────────────────────────────────────────────────────
router.get("/pages", getAllPages);                        // All pages (paginated + searchable)

// ── Statistics ────────────────────────────────────────────────────────────────
router.get("/stats", getStats);                          // Aggregate crawl statistics

module.exports = router;
