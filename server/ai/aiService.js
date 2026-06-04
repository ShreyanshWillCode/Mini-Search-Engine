/**
 * aiService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Core RAG (Retrieval-Augmented Generation) orchestrator for GravitySearch.
 *
 * Pipeline:
 *   1. searchWithContent()  → top-5 ranked docs with full page content
 *   2. promptBuilder        → build structured Gemini prompt from docs
 *   3. Gemini 1.5 Flash     → generate grounded, cited answer
 *   4. Redis cache          → cache AI response for 10 minutes
 *
 * Graceful degradation:
 *   - If GEMINI_API_KEY is missing  → throws a clear configuration error.
 *   - If Gemini times out / errors  → throws, caller returns 500.
 *   - If Redis is down              → skips cache, still answers.
 */

"use strict";

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { searchWithContent }  = require("../services/searchService");
const { buildPrompt, computeConfidence } = require("./promptBuilder");
const cache                  = require("../cache/cacheManager");

const AI_CACHE_NAMESPACE = "ai";
const AI_CACHE_TTL_SEC   = 600;   // 10 minutes
const GEMINI_MODEL       = "gemini-1.5-flash";
const GEMINI_TIMEOUT_MS  = 25000; // 25 second timeout

/**
 * aiSearch(query, options)
 * ─────────────────────────────────────────────────────────────────────────────
 * Main entry point. Called by POST /api/ai-search.
 *
 * @param {string} query
 * @param {object} options  — { strategy, alpha, beta, topK }
 * @returns {Promise<{
 *   answer:     string,
 *   sources:    Array<{ title, url, score }>,
 *   confidence: number,
 *   tokens:     string[],
 *   latencyMs:  number,
 *   fromCache:  boolean,
 * }>}
 */
async function aiSearch(query, { strategy = "union", alpha = 0.7, beta = 0.3, topK = 5 } = {}) {
  const t0 = Date.now();

  // ── Validate API key ───────────────────────────────────────────────────────
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured. Add it to your .env file.");
  }

  // ── Cache lookup ───────────────────────────────────────────────────────────
  const cacheKey = query.trim().toLowerCase();
  const cached   = await cache.get(AI_CACHE_NAMESPACE, cacheKey);
  if (cached) {
    return { ...cached, fromCache: true, latencyMs: Date.now() - t0 };
  }

  // ── 1. Retrieve top documents WITH content ─────────────────────────────────
  const searchResult = await searchWithContent(query, {
    limit: topK,
    page: 1,
    strategy,
    alpha,
    beta,
  });

  const { results, tokens } = searchResult;

  // ── 2. Build Gemini prompt from retrieved docs ─────────────────────────────
  const { systemPrompt, userPrompt } = buildPrompt(query, results);

  // ── 3. Compute confidence proxy ────────────────────────────────────────────
  const confidence = computeConfidence(tokens, results);

  // ── 4. Call Gemini API ─────────────────────────────────────────────────────
  let answer;
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: systemPrompt,
      generationConfig: {
        maxOutputTokens: 512,
        temperature: 0.2,    // Low temperature → more factual, less creative
        topP: 0.8,
      },
    });

    // Race against a timeout to avoid hanging the HTTP request
    const geminiCall = model.generateContent(userPrompt);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Gemini API timeout after 25s")), GEMINI_TIMEOUT_MS)
    );

    const geminiResult = await Promise.race([geminiCall, timeoutPromise]);
    answer = geminiResult.response.text().trim();
  } catch (err) {
    console.error("[AI Service] Gemini call failed:", err.message);
    throw err;
  }

  // ── 5. Build clean sources list ────────────────────────────────────────────
  const sources = results.map((r, i) => ({
    index:  i + 1,
    title:  r.title || "Untitled",
    url:    r.url,
    score:  r.score,
  }));

  // ── 6. Cache result ────────────────────────────────────────────────────────
  const responsePayload = {
    answer,
    sources,
    confidence,
    tokens,
    fromCache: false,
    latencyMs: Date.now() - t0,
  };

  // Use a custom TTL for AI answers (10 min) — cache.set uses namespace defaults
  // so we pass the ttl explicitly via the raw redis client if available
  await cache.set(AI_CACHE_NAMESPACE, cacheKey, responsePayload, AI_CACHE_TTL_SEC);

  return responsePayload;
}

module.exports = { aiSearch };
