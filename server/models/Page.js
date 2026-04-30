const mongoose = require("mongoose");

/**
 * PageSchema — represents a single crawled web page.
 *
 * This is the primary output document of the crawler stage.
 * The `links` array encodes the adjacency list for the crawl graph.
 * Future indexing and ranking stages will consume these documents.
 */
const pageSchema = new mongoose.Schema(
  {
    // ── Core Identity ────────────────────────────────────────────────────────
    url: {
      type: String,
      required: true,
      unique: true,        // Enforces de-duplication at DB level
      trim: true,
      index: true,
    },

    // ── Extracted Content ────────────────────────────────────────────────────
    title: {
      type: String,
      default: "",
      trim: true,
    },

    content: {
      type: String,
      default: "",
    },

    // ── Graph / Link Data (Adjacency List) ───────────────────────────────────
    links: {
      type: [String],
      default: [],
    },

    // ── Crawl Metadata ───────────────────────────────────────────────────────
    depth: {
      type: Number,
      default: 0,
      min: 0,
    },

    crawlSessionId: {
      type: String,
      required: true,
      index: true,           // Enables querying all pages from a single crawl
    },

    statusCode: {
      type: Number,
      default: 200,
    },

    crawledAt: {
      type: Date,
      default: Date.now,
    },

    // ── Error Tracking ───────────────────────────────────────────────────────
    error: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,          // adds createdAt + updatedAt
    versionKey: false,
  }
);

// ── Text index for future full-text search (indexing stage) ──────────────────
pageSchema.index({ title: "text", content: "text" });

// ── Compound index for efficient session-scoped queries ──────────────────────
pageSchema.index({ crawlSessionId: 1, depth: 1 });

module.exports = mongoose.model("Page", pageSchema);
