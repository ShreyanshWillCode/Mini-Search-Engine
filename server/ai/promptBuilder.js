/**
 * promptBuilder.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Constructs the Gemini prompt from retrieved search results.
 *
 * Strategy:
 *   - System prompt:  ground the LLM to ONLY use provided documents.
 *   - Context block:  up to 5 documents, each with title, url, and a
 *                     400-character content excerpt.
 *   - User question:  the raw query string.
 *
 * Total context is intentionally kept compact (~6–8 KB) so responses are fast.
 */

"use strict";

const MAX_DOCS          = 5;
const EXCERPT_LENGTH    = 500;   // chars per document

/**
 * buildPrompt(query, searchResults)
 * ─────────────────────────────────────────────────────────────────────────────
 * @param {string} query         — The user's raw search query
 * @param {Array}  searchResults — Top-N results from searchWithContent()
 *                                 Each: { url, title, score, snippet, content }
 *
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
function buildPrompt(query, searchResults) {
  const docs = searchResults.slice(0, MAX_DOCS);

  // ── System prompt ──────────────────────────────────────────────────────────
  const systemPrompt = `You are GravitySearch AI, an intelligent search assistant built on top of a real web crawler and search engine.

Your task is to answer the user's question EXCLUSIVELY using the provided source documents retrieved by the search engine.

STRICT RULES:
1. NEVER hallucinate. NEVER invent facts not present in the documents.
2. If the documents do not contain sufficient information to answer the question, respond with EXACTLY: "Insufficient information found in indexed pages."
3. Keep your answer concise and well-structured (3–6 sentences max).
4. Cite your sources inline using [Source 1], [Source 2], etc. notation.
5. Do NOT make up URLs or titles. Only reference the documents provided to you.

You are demonstrating a Retrieval-Augmented Generation (RAG) pipeline where the retrieval is performed by a custom TF-IDF + PageRank search engine.`;

  // ── Context block ──────────────────────────────────────────────────────────
  let contextBlock = "";

  if (docs.length === 0) {
    contextBlock = "No documents were retrieved from the search engine for this query.";
  } else {
    contextBlock = docs.map((doc, i) => {
      const title   = doc.title   || "Untitled";
      const url     = doc.url     || "N/A";
      const content = doc.content || doc.snippet || "";

      // Strip HTML tags from content/snippet before passing to LLM
      const cleanContent = content
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, EXCERPT_LENGTH);

      return `[Source ${i + 1}]
Title: ${title}
URL: ${url}
Relevance Score: ${doc.score?.toFixed(4) ?? "N/A"}
Content Excerpt:
${cleanContent}${cleanContent.length >= EXCERPT_LENGTH ? "..." : ""}`;
    }).join("\n\n---\n\n");
  }

  // ── Full user prompt ───────────────────────────────────────────────────────
  const userPrompt = `RETRIEVED DOCUMENTS:
─────────────────────────────────────
${contextBlock}
─────────────────────────────────────

USER QUESTION: ${query}

Answer based strictly on the documents above:`;

  return { systemPrompt, userPrompt };
}

/**
 * computeConfidence(query, searchResults, tokens)
 * ─────────────────────────────────────────────────────────────────────────────
 * Proxy confidence score: fraction of query tokens found in retrieved docs.
 *
 * @returns {number}  0.0 – 1.0
 */
function computeConfidence(tokens, searchResults) {
  if (!tokens || tokens.length === 0 || searchResults.length === 0) return 0;

  const allContent = searchResults
    .map(r => `${r.title || ""} ${r.content || r.snippet || ""}`.toLowerCase())
    .join(" ");

  const matchedCount = tokens.filter(t => allContent.includes(t.toLowerCase())).length;
  return parseFloat((matchedCount / tokens.length).toFixed(2));
}

module.exports = { buildPrompt, computeConfidence };
