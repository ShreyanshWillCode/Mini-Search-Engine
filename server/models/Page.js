/**
 * Page.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Mongoose schema for a single crawled web page.
 *
 * Design principles:
 *   - Minimal fields — only what the crawler produces + what search needs
 *   - No raw HTML stored — content is always cleaned plain text (parser's job)
 *   - Unique index on url prevents duplicate documents at the DB level
 *   - Text index on title + content enables MongoDB full-text search
 *     (Stage 2 Indexer will build an inverted index on top of this)
 *   - mongoose timestamps adds createdAt + updatedAt automatically
 *   - crawledAt is explicitly set on every upsert so it reflects the LAST
 *     time this specific page was re-crawled (different from createdAt)
 */

const mongoose = require("mongoose");

const pageSchema = new mongoose.Schema(
  {
    // ── Core fields ──────────────────────────────────────────────────────────

    url: {
      type: String,
      required: [true, "URL is required"],
      unique: true, // unique index — duplicate key error (code 11000) on collision
      trim: true,
    },

    title: {
      type: String,
      default: "No title",
      trim: true,
      maxlength: [512, "Title must be ≤ 512 characters"],
    },

    // Cleaned plain text — NO raw HTML. HTML stripping is the parser's job.
    // Capped at 5 000 chars in the parser to keep documents lean.
    content: {
      type: String,
      default: "",
    },

    // Outgoing links extracted from <a href=""> — normalised, deduplicated.
    // Stored as an adjacency list for the future PageRank stage.
    links: {
      type: [String],
      default: [],
    },

    // BFS depth at which this page was first discovered.
    // Useful for debugging crawl breadth and building depth-aware ranking.
    depth: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Importance score calculated via PageRank algorithm.
    // Updated iteratively based on incoming link structure.
    pagerank: {
      type: Number,
      default: 0,
    },

    // Last crawl timestamp — updated on every upsert.
    // Distinct from createdAt (which Mongoose sets only on first insert).
    crawledAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    // Mongoose auto-manages createdAt (immutable) and updatedAt (mutable)
    timestamps: true,
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────

// Full-text index — enables $text queries for Stage 2 (Indexer).
// "text" weights give title matches higher relevance than content matches.
pageSchema.index(
  { title: "text", content: "text" },
  { weights: { title: 10, content: 1 }, name: "text_search_index" }
);

// Compound index for common API query pattern: sort by crawledAt descending.
pageSchema.index({ crawledAt: -1 });

// ── Virtuals ──────────────────────────────────────────────────────────────────

/**
 * linksCount — computed on-the-fly from the links array.
 * Not stored in MongoDB; used by the API layer to avoid sending the full
 * links array when a count is sufficient.
 */
pageSchema.virtual("linksCount").get(function () {
  return this.links ? this.links.length : 0;
});

/**
 * contentSnippet — first 200 characters of content, trimmed.
 * Used by the paginated API to keep response payloads small.
 */
pageSchema.virtual("contentSnippet").get(function () {
  return this.content ? this.content.slice(0, 200).trim() : "";
});

module.exports = mongoose.model("Page", pageSchema);
