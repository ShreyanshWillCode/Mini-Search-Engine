"use strict";

const express = require("express");
const router  = express.Router();
const Page    = require("../models/Page");
const cache   = require("../cache/cacheManager");

// GET /api/graph
// Returns node and link data for the D3 visualization.
// Cached for 10 minutes (graph data rarely changes mid-session).
router.get("/", async (req, res) => {
  try {
    const limit    = Math.min(500, parseInt(req.query.limit, 10) || 500);
    const cacheKey = `graph-${limit}`;

    // Check Redis cache first
    const cached = await cache.get("graph", cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, fromCache: true, ...cached });
    }

    // Fetch top pages by PageRank
    const pages = await Page.find({})
      .sort({ pagerank: -1, depth: 1 })
      .limit(limit)
      .lean();

    const nodes  = [];
    const links  = [];
    const nodeIds = new Set(pages.map((p) => p.url));

    pages.forEach((page) => {
      nodes.push({
        id:       page.url,
        title:    page.title || "No Title",
        pagerank: page.pagerank || 0,
        depth:    page.depth   || 0,
        group:    page.depth   || 0,
      });

      if (page.links && Array.isArray(page.links)) {
        page.links.forEach((targetUrl) => {
          if (nodeIds.has(targetUrl)) {
            links.push({ source: page.url, target: targetUrl, value: 1 });
          }
        });
      }
    });

    const payload = { nodes, links };
    await cache.set("graph", cacheKey, payload); // 10-min TTL (default for "graph" namespace)

    return res.status(200).json({ success: true, fromCache: false, ...payload });
  } catch (err) {
    console.error("[Graph API] Error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
