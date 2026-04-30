/**
 * index.js – Entry point for the Search Engine Crawler backend.
 *
 * Responsibilities:
 *   1. Load environment variables (.env)
 *   2. Connect to MongoDB
 *   3. Configure Express middleware (CORS, JSON body parser, Morgan logger)
 *   4. Mount API routes
 *   5. Health-check route
 *   6. Global error handler
 *   7. Start HTTP server
 */

const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const connectDB = require("./config/db");
const crawlerRoutes = require("./routes/crawlerRoutes");

// ── Connect to MongoDB ────────────────────────────────────────────────────────
connectDB();

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(morgan("dev"));

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "Search Engine Crawler",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    endpoints: {
      "POST /api/crawl":           "Start a new crawl { seedURL, maxDepth, maxPages }",
      "GET  /api/crawl/stats":     "Quick DB statistics",
      "GET  /api/crawl/pages":     "Paginated crawled pages list ?page=1&limit=20",
      "GET  /api/crawl/pages/:id": "Single crawled page by Mongo _id",
      "DELETE /api/crawl/pages":   "Clear all crawled pages",
    },
  });
});

// Crawler API
app.use("/api/crawl", crawlerRoutes);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: `Route ${req.method} ${req.path} not found.` });
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.stack);
  res.status(500).json({ success: false, error: err.message || "Internal server error" });
});

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀  Crawler service running on http://localhost:${PORT}`);
});

module.exports = app; // exported for potential testing
