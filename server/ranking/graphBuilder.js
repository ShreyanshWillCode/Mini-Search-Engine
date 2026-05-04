"use strict";

/**
 * graphBuilder.js
 * 
 * Takes an array of Page objects from MongoDB and constructs
 * the in-memory graph data structures required for PageRank.
 */

function buildGraph(pages) {
  const urlToId = new Map();
  const idToUrl = new Map();

  // 1. Map URLs to their local database IDs for O(1) lookup
  for (const page of pages) {
    const idStr = page._id.toString();
    urlToId.set(page.url, idStr);
    idToUrl.set(idStr, page.url);
  }

  // 2. Initialize graph structures
  const incomingLinks = new Map(); // pageId -> Set of incoming pageIds
  const outDegree = new Map();     // pageId -> number of valid outgoing links
  const danglingNodes = new Set(); // pageIds with 0 valid outgoing links

  // Initialize empty sets and 0 degrees for all pages in DB
  for (const page of pages) {
    const idStr = page._id.toString();
    incomingLinks.set(idStr, new Set());
    outDegree.set(idStr, 0);
  }

  // 3. Populate edges
  for (const page of pages) {
    const sourceId = page._id.toString();
    let validOutLinks = 0;

    for (const targetUrl of page.links) {
      const targetId = urlToId.get(targetUrl);
      
      // We only consider edges to pages that we have actually crawled and stored.
      // If a page links to a URL we haven't crawled, we ignore that edge.
      if (targetId && targetId !== sourceId) { // Ignore self-links
        // Add to incoming links of target
        incomingLinks.get(targetId).add(sourceId);
        validOutLinks++;
      }
    }

    outDegree.set(sourceId, validOutLinks);

    if (validOutLinks === 0) {
      danglingNodes.add(sourceId);
    }
  }

  return {
    urlToId,
    idToUrl,
    incomingLinks,
    outDegree,
    danglingNodes,
    N: pages.length
  };
}

module.exports = { buildGraph };
