const mongoose = require("mongoose");

/**
 * Schema representing a single crawled web page.
 *
 * url     - The canonical URL of the page (unique index prevents duplicate crawls).
 * title   - The <title> tag content.
 * content - Cleaned body text (first 5 000 characters to keep documents lean).
 * links   - All absolute hrefs extracted from <a> tags on this page.
 * depth   - BFS depth at which this page was discovered.
 * crawledAt - Timestamp of when this page was stored.
 */
const pageSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    title: {
      type: String,
      default: "No title",
      trim: true,
    },
    content: {
      type: String,
      default: "",
    },
    links: {
      type: [String],
      default: [],
    },
    depth: {
      type: Number,
      default: 0,
    },
    crawledAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Full-text index so the indexer stage can query efficiently
pageSchema.index({ title: "text", content: "text" });

module.exports = mongoose.model("Page", pageSchema);
