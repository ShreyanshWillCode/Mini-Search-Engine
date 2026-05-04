"use strict";

const Page = require("../models/Page");
const { buildGraph } = require("./graphBuilder");

/**
 * computePageRank
 * 
 * Computes the PageRank for all crawled pages iteratively.
 * Uses the formula:
 *   PR(A) = (1-d)/N + d * ( \sum_{i \in In(A)} \frac{PR(i)}{OutDegree(i)} + \frac{DanglingSum}{N} )
 * 
 * @param {number} iterations - Number of iterations to run (default: 20)
 * @param {number} d - Damping factor (default: 0.85)
 * @returns {Promise<{ pagesProcessed: number, iterations: number, status: string }>}
 */
async function computePageRank(iterations = 20, d = 0.85) {
  // 1. Fetch all pages (only needed fields to save memory)
  const pages = await Page.find({}, { _id: 1, url: 1, links: 1 }).lean();
  
  if (pages.length === 0) {
    return { pagesProcessed: 0, iterations: 0, status: "completed" };
  }

  // 2. Build graph
  const graph = buildGraph(pages);
  const { incomingLinks, outDegree, danglingNodes, N } = graph;

  // 3. Initialize PageRank
  let pr = new Map();
  const initialRank = 1.0 / N;
  
  for (const page of pages) {
    pr.set(page._id.toString(), initialRank);
  }

  // 4. Iterative computation
  for (let iter = 0; iter < iterations; iter++) {
    const newPr = new Map();
    let danglingSum = 0;

    // Calculate sum of PageRanks from all dangling nodes
    for (const danglingId of danglingNodes) {
      danglingSum += pr.get(danglingId);
    }

    // Compute new PageRank for each node
    for (const page of pages) {
      const idStr = page._id.toString();
      
      let rankSum = 0;
      const inLinks = incomingLinks.get(idStr);
      
      for (const inId of inLinks) {
        rankSum += pr.get(inId) / outDegree.get(inId);
      }

      // Distribute dangling node rank evenly across all nodes
      const distributedDangling = danglingSum / N;
      
      // PageRank formula
      const newRank = ((1 - d) / N) + d * (rankSum + distributedDangling);
      newPr.set(idStr, newRank);
    }

    pr = newPr; // Update for next iteration
  }

  // 5. Batch update MongoDB
  const bulkOps = [];
  for (const [idStr, rank] of pr.entries()) {
    bulkOps.push({
      updateOne: {
        filter: { _id: idStr },
        update: { $set: { pagerank: rank } }
      }
    });
  }

  // Execute in batches if large, but Mongoose bulkWrite handles large arrays reasonably well.
  // For production with millions, we would chunk this array.
  if (bulkOps.length > 0) {
    await Page.bulkWrite(bulkOps, { ordered: false });
  }

  return {
    pagesProcessed: N,
    iterations,
    status: "completed"
  };
}

module.exports = { computePageRank };
