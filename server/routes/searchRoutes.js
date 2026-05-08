/**
 * searchRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Mounts under /api (see index.js):
 *
 *   GET  /api/search?q=...&strategy=union&limit=10
 *   POST /api/index/rebuild
 *   GET  /api/index/stats
 *   GET  /api/autocomplete?q=<prefix>&limit=8
 *   GET  /api/cache/stats
 */

"use strict";

const express = require("express");
const router  = express.Router();

const { search, getIndexStats }   = require("../services/searchService");
const { indexAllDocuments }       = require("../indexer/indexBuilder");
const { getSuggestions, getStats: getTrieStats, trackSearchQuery, buildTrie } = require("../autocomplete/suggestionService");
const cache                       = require("../cache/cacheManager");

// ── GET /api/search ───────────────────────────────────────────────────────────

router.get("/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();

    if (!q) {
      return res.status(400).json({
        success: false,
        error:   "Query parameter 'q' is required. Example: /api/search?q=web+crawler",
      });
    }

    const modeParam = req.query.mode || req.query.strategy;
    const strategy  = ["union", "intersection"].includes(modeParam) ? modeParam : "union";
    const limit     = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const page      = Math.max(1, parseInt(req.query.page, 10) || 1);
    const alpha     = req.query.alpha !== undefined ? parseFloat(req.query.alpha) : 0.7;
    const beta      = req.query.beta  !== undefined ? parseFloat(req.query.beta)  : 0.3;

    const result = await search(q, { strategy, limit, page, alpha, beta });

    // Passively learn from every successful search (non-blocking)
    if (!result.fromCache) {
      trackSearchQuery(q);
    }

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error("[Search API] Error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/autocomplete ─────────────────────────────────────────────────────

/**
 * Returns real-time prefix suggestions from the in-memory Trie.
 *
 * Query params:
 *   q     {string}  — prefix string (e.g., "mer")
 *   limit {number}  — max suggestions (default 8, max 15)
 */
router.get("/autocomplete", async (req, res) => {
  try {
    const prefix = (req.query.q || "").trim();
    if (!prefix) return res.json({ success: true, suggestions: [] });

    const limit = Math.min(15, Math.max(1, parseInt(req.query.limit, 10) || 8));

    // Check Redis cache for this prefix
    const cacheKey = `${prefix.toLowerCase()}|${limit}`;
    const cached   = await cache.get("autocomplete", cacheKey);
    if (cached) {
      return res.json({ success: true, suggestions: cached, fromCache: true });
    }

    const suggestions = getSuggestions(prefix, limit);

    // Cache for 2 minutes
    await cache.set("autocomplete", cacheKey, suggestions);

    return res.json({ success: true, suggestions, fromCache: false });
  } catch (err) {
    console.error("[Autocomplete API] Error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/cache/stats ──────────────────────────────────────────────────────

router.get("/cache/stats", async (req, res) => {
  try {
    const [cacheMetrics, trieStats] = await Promise.all([
      cache.getMetrics(),
      getTrieStats(),
    ]);
    return res.json({ success: true, cache: cacheMetrics, trie: trieStats });
  } catch (err) {
    console.error("[Cache Stats] Error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/index/rebuild ───────────────────────────────────────────────────

router.post("/index/rebuild", async (req, res) => {
  try {
    console.log("[Index] Full rebuild triggered via API…");
    const result = await indexAllDocuments();

    // Invalidate all caches and rebuild Trie with fresh data
    await cache.invalidateAll();
    buildTrie(); // fire-and-forget (async, may take a few seconds)

    return res.status(200).json({
      success: true,
      message: "Index rebuild complete. Cache cleared. Trie rebuilding…",
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
    // Cache index stats for 1 minute — they rarely change mid-session
    const cached = await cache.get("stats", "index");
    if (cached) return res.json({ success: true, fromCache: true, ...cached });

    const stats = await getIndexStats();
    await cache.set("stats", "index", stats);
    return res.json({ success: true, fromCache: false, ...stats });
  } catch (err) {
    console.error("[Index] Stats error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
