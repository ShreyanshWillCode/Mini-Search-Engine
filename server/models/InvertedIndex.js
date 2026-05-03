/**
 * InvertedIndex.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Mongoose schema for the inverted index collection.
 *
 * Structure (classic inverted index):
 *
 *   word  ──►  posting list
 *   "web"      [{ docId, url, title, frequency }, ...]
 *
 * Why denormalise url + title into each posting?
 *   Search results need url + title. Storing them here avoids a second
 *   DB round-trip ($lookup / findById) for every result document.
 *   The trade-off (slight data duplication) is acceptable for a search engine
 *   where read performance is the top priority.
 *
 * Deduplication guarantee:
 *   Each (word, docId) pair must be unique within the documents array.
 *   This is enforced by the indexBuilder's pipeline update logic, NOT by
 *   a DB-level unique index on the subdocument (MongoDB doesn't support that
 *   natively for array elements in a scalable way).
 */

const mongoose = require("mongoose");

// ── Posting subdocument ───────────────────────────────────────────────────────

/**
 * One entry in a word's posting list.
 * _id is disabled — we never need to address individual postings by ID,
 * and suppressing it saves storage at scale.
 */
const postingSchema = new mongoose.Schema(
  {
    // Page._id stored as String (avoids ObjectId reference overhead for lookup)
    docId: {
      type:     String,
      required: true,
    },

    // Denormalised for single-query search result assembly
    url:   { type: String, default: "" },
    title: { type: String, default: "No title" },

    // Term frequency: how many times this word appears in this document.
    // Used for TF-IDF scoring in Stage 3.
    frequency: {
      type:    Number,
      default: 1,
      min:     1,
    },
  },
  { _id: false }  // no ObjectId per posting — saves memory + index space
);

// ── Main schema ───────────────────────────────────────────────────────────────

const invertedIndexSchema = new mongoose.Schema(
  {
    // The indexed word — unique across all documents in the collection.
    // This is the HashMap key in the persistent inverted index.
    word: {
      type:      String,
      required:  [true, "word is required"],
      unique:    true,   // unique B-tree index → O(log n) lookup per word
      index:     true,
      trim:      true,
      lowercase: true,
      maxlength: 50,
    },

    // Posting list: all documents that contain this word.
    // Semantics mirror a Set — each docId appears at most once (enforced by
    // the pipeline update in indexBuilder, not by a DB constraint).
    documents: {
      type:    [postingSchema],
      default: [],
    },
  },
  {
    // createdAt: when this word was first indexed
    // updatedAt: when the posting list was last modified
    timestamps: true,
  }
);

// ── Additional indexes ────────────────────────────────────────────────────────

// Useful for "find all words containing document X" queries (future PageRank)
invertedIndexSchema.index({ "documents.docId": 1 });

module.exports = mongoose.model("InvertedIndex", invertedIndexSchema);
