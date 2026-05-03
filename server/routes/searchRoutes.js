/**
 * searchRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Mounts under /api (see index.js):
 *
 *   GET  /api/search?q=...&strategy=union&limit=10
 *        Search the inverted index for keyword(s).
 *
 *   POST /api/index/rebuild
 *        Full index rebuild — wipes InvertedIndex and re-indexes all Pages.
 *        Use after clearing the crawler DB and re-crawling.
 *
 *   GET  /api/index/stats
 *        Quick statistics: total words indexed, top words by document count.
 */

"use strict";

const express = require("express");
const router  = express.Router();

const { search, getIndexStats }    = require("../services/searchService");
const { indexAllDocuments }        = require("../indexer/indexBuilder");

// ── GET /api/search ───────────────────────────────────────────────────────────

/**
 * Query the inverted index.
 *
 * Query params:
 *   q          {string}  required — raw search query, e.g. "web crawler"
 *   strategy   {string}  optional — 'union' (default) | 'intersection'
 *   limit      {number}  optional — max results (default 10, max 50)
 */
router.get("/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();

    if (!q) {
      return res.status(400).json({
        success: false,
        error:   "Query parameter 'q' is required. Example: /api/search?q=web+crawler",
      });
    }

    const strategy = ["union", "intersection"].includes(req.query.strategy)
      ? req.query.strategy
      : "union";

    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));

    const result = await search(q, { strategy, limit });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error("[Search API] Error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/index/rebuild ───────────────────────────────────────────────────

/**
 * Trigger a full index rebuild.
 * Wipes the InvertedIndex collection and re-indexes every Page document.
 *
 * This is a slow operation for large datasets — respond immediately and
 * run in the background? For a mini search engine, synchronous is fine.
 */
router.post("/index/rebuild", async (req, res) => {
  try {
    console.log("[Index] Full rebuild triggered via API…");
    const result = await indexAllDocuments();

    return res.status(200).json({
      success: true,
      message: "Index rebuild complete.",
      ...result,
    });
  } catch (err) {
    console.error("[Index] Rebuild error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/index/stats ──────────────────────────────────────────────────────

router.get("/index/stats", async (req, res) => {
  try {
    const stats = await getIndexStats();
    return res.status(200).json({ success: true, ...stats });
  } catch (err) {
    console.error("[Index] Stats error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
