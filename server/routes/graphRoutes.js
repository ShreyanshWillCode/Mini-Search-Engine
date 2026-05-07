"use strict";

const express = require("express");
const router = express.Router();
const Page = require("../models/Page");

// GET /api/graph
// Returns node and link data for the D3 visualization.
router.get("/", async (req, res) => {
  try {
    const limit = Math.min(500, parseInt(req.query.limit, 10) || 500);
    
    // Fetch top pages by PageRank or recency
    const pages = await Page.find({})
      .sort({ pagerank: -1, depth: 1 })
      .limit(limit)
      .lean();

    const nodes = [];
    const links = [];
    
    // Create a Set of node IDs for fast lookup (so we don't create links to nodes that aren't in the dataset)
    const nodeIds = new Set(pages.map(p => p.url));

    pages.forEach(page => {
      // Add node
      nodes.push({
        id: page.url,
        title: page.title || "No Title",
        pagerank: page.pagerank || 0,
        depth: page.depth || 0,
        group: page.depth || 0, // D3 color grouping by depth
      });

      // Add edges (links)
      if (page.links && Array.isArray(page.links)) {
        page.links.forEach(targetUrl => {
          // Only add edge if the target node is also in our limited dataset
          if (nodeIds.has(targetUrl)) {
            links.push({
              source: page.url,
              target: targetUrl,
              value: 1
            });
          }
        });
      }
    });

    return res.status(200).json({
      success: true,
      nodes,
      links
    });
  } catch (err) {
    console.error("[Graph API] Error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
