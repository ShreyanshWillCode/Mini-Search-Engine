"use strict";

const { computePageRank } = require("../ranking/pagerank");

/**
 * calculatePageRank
 * POST /api/rank/pagerank
 */
async function calculatePageRank(req, res, next) {
  try {
    const { iterations = 20, d = 0.85 } = req.body;
    
    // Convert to numbers if they are strings
    const iters = parseInt(iterations, 10);
    const damp = parseFloat(d);

    if (isNaN(iters) || iters < 1 || iters > 100) {
      return res.status(400).json({ success: false, error: "Iterations must be between 1 and 100" });
    }
    
    if (isNaN(damp) || damp <= 0 || damp >= 1) {
      return res.status(400).json({ success: false, error: "Damping factor 'd' must be between 0 and 1" });
    }

    const result = await computePageRank(iters, damp);

    res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { calculatePageRank };
