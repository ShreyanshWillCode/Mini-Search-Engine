/**
 * crawler.js — BFS Web Crawler
 *
 * Data Structures used:
 *  ┌─────────────────────────────────────────────────────────────────────┐
 *  │  Queue   → BFS frontier (FIFO). Each entry: { url, depth }         │
 *  │  Set     → visited URLs (O(1) lookup). Prevents duplicate crawling  │
 *  │  Map     → adjacency list: url → [linked urls]                      │
 *  └─────────────────────────────────────────────────────────────────────┘
 *
 * Algorithm:
 *  1. Push seed URL into queue, mark as visited
 *  2. While queue is non-empty AND constraints not exceeded:
 *     a. Dequeue {url, depth}
 *     b. Fetch HTML via axios (with timeout)
 *     c. Parse with cheerio → extract title, text, links
 *     d. Normalize & filter links
 *     e. For each unvisited link: add to queue, mark visited
 *     f. Persist page document to MongoDB
 *  3. Return crawl statistics
 */

const axios = require("axios");
const cheerio = require("cheerio");
const { URL } = require("url");
const validUrl = require("valid-url");
const Page = require("../models/Page");

// ─── Crawler Configuration ─────────────────────────────────────────────────────
const DEFAULT_MAX_DEPTH   = parseInt(process.env.DEFAULT_MAX_DEPTH)  || 3;
const DEFAULT_MAX_PAGES   = parseInt(process.env.DEFAULT_MAX_PAGES)  || 50;
const CRAWL_TIMEOUT_MS    = parseInt(process.env.CRAWL_TIMEOUT_MS)   || 10000;

// Common browser User-Agent to reduce 403 rejections
const USER_AGENT =
  "Mozilla/5.0 (compatible; SearchEngineBot/1.0; +https://github.com/search-engine)";

/**
 * Normalizes a raw href into an absolute URL.
 * Returns null for invalid, relative (non-http), fragment, or mailto links.
 *
 * @param {string} href    - Raw href attribute value
 * @param {string} baseUrl - The page's own URL (used to resolve relative paths)
 * @returns {string|null}
 */
function normalizeUrl(href, baseUrl) {
  if (!href || typeof href !== "string") return null;

  href = href.trim();

  // Skip fragments, mailto, javascript, tel
  if (
    href.startsWith("#") ||
    href.startsWith("mailto:") ||
    href.startsWith("javascript:") ||
    href.startsWith("tel:")
  )
    return null;

  try {
    const resolved = new URL(href, baseUrl);

    // Only crawl http and https
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:")
      return null;

    // Remove fragment — #section1 and #section2 on the same page are the same page
    resolved.hash = "";

    return resolved.toString();
  } catch {
    return null;
  }
}

/**
 * Extracts plain text from an HTML document, stripping scripts/styles/nav.
 * Collapses whitespace and limits to 5000 chars to keep documents lean.
 *
 * @param {CheerioAPI} $ - Loaded cheerio instance
 * @returns {string}
 */
function extractText($) {
  // Remove noise elements before extracting text
  $("script, style, noscript, nav, footer, header, aside").remove();

  return $("body")
    .text()
    .replace(/\s+/g, " ")  // Collapse whitespace
    .trim()
    .slice(0, 5000);        // Cap content length
}

/**
 * Fetches a URL and parses it with cheerio.
 * Returns { $, statusCode } or throws on network/timeout errors.
 *
 * @param {string} url
 * @returns {Promise<{ $: CheerioAPI, statusCode: number }>}
 */
async function fetchPage(url) {
  const response = await axios.get(url, {
    timeout: CRAWL_TIMEOUT_MS,
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    maxRedirects: 5,
    // Don't throw on 4xx/5xx so we can record the status code
    validateStatus: (status) => status < 600,
    // Limit response size to 5MB — avoids memory spikes on huge pages
    maxContentLength: 5 * 1024 * 1024,
  });

  const contentType = response.headers["content-type"] || "";
  if (!contentType.includes("text/html")) {
    throw new Error(`Non-HTML content-type: ${contentType}`);
  }

  const $ = cheerio.load(response.data);
  return { $, statusCode: response.status };
}

/**
 * BFS Web Crawler
 *
 * @param {Object} options
 * @param {string} options.seedUrl       - Starting URL for the crawl
 * @param {number} [options.maxDepth]    - BFS depth limit (default: 3)
 * @param {number} [options.maxPages]    - Total page cap (default: 50)
 * @param {string} options.sessionId     - Unique ID grouping this crawl run
 * @param {Function} [options.onProgress] - Optional callback: (stats) => void
 *
 * @returns {Promise<CrawlStats>}
 */
async function crawl({ seedUrl, maxDepth, maxPages, sessionId, onProgress }) {
  maxDepth = Math.min(maxDepth ?? DEFAULT_MAX_DEPTH, 10);  // Hard cap
  maxPages = Math.min(maxPages ?? DEFAULT_MAX_PAGES, 200); // Hard cap

  // ── Data Structures ────────────────────────────────────────────────────────

  /**
   * BFS Queue — each entry is a node: { url: string, depth: number }
   * We use a plain array with shift() for FIFO semantics.
   * (For very large crawls, replace with a proper deque or Redis queue.)
   */
  const queue = [];

  /**
   * Visited Set — O(1) lookup to avoid re-crawling.
   * Seeds before enqueueing so concurrent fetches can't race on the same URL.
   */
  const visited = new Set();

  /**
   * Adjacency List — maps each crawled URL to its outbound links.
   * Represents the web as a directed graph for future PageRank computation.
   */
  const adjacencyList = new Map();

  // ── Statistics Tracker ─────────────────────────────────────────────────────
  const stats = {
    sessionId,
    seedUrl,
    maxDepth,
    maxPages,
    totalCrawled:  0,
    totalErrors:   0,
    totalLinks:    0,
    depthDistribution: {},  // { "0": 1, "1": 5, "2": 12, ... }
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
  };

  const startTime = Date.now();

  // ── Seed the Queue ─────────────────────────────────────────────────────────
  queue.push({ url: seedUrl, depth: 0 });
  visited.add(seedUrl);

  console.log(`\n🕷️  [${sessionId}] BFS crawl started`);
  console.log(`   Seed: ${seedUrl} | maxDepth: ${maxDepth} | maxPages: ${maxPages}\n`);

  // ── BFS Main Loop ──────────────────────────────────────────────────────────
  while (queue.length > 0 && stats.totalCrawled < maxPages) {
    // Dequeue — FIFO guarantees BFS level-by-level traversal
    const { url, depth } = queue.shift();

    // Depth constraint: stop expanding nodes beyond maxDepth
    if (depth > maxDepth) continue;

    const pageDoc = {
      url,
      depth,
      crawlSessionId: sessionId,
      title:      "",
      content:    "",
      links:      [],
      statusCode: 0,
      error:      null,
    };

    // ── Fetch & Parse ──────────────────────────────────────────────────────
    try {
      const { $, statusCode } = await fetchPage(url);

      pageDoc.statusCode = statusCode;

      // Non-2xx responses are recorded but not expanded
      if (statusCode < 200 || statusCode >= 300) {
        pageDoc.error = `HTTP ${statusCode}`;
        stats.totalErrors++;
        console.log(`  ⚠️  [${depth}] ${url} → HTTP ${statusCode}`);
      } else {
        // ── Extract Content ──────────────────────────────────────────────
        pageDoc.title   = $("title").first().text().trim() || url;
        pageDoc.content = extractText($);

        // ── Extract Links ────────────────────────────────────────────────
        const rawLinks = [];
        $("a[href]").each((_, el) => {
          rawLinks.push($(el).attr("href"));
        });

        // Normalize & deduplicate links found on this page
        const normalizedLinks = [
          ...new Set(
            rawLinks
              .map((href) => normalizeUrl(href, url))
              .filter(Boolean)
          ),
        ];

        pageDoc.links = normalizedLinks;
        adjacencyList.set(url, normalizedLinks);

        // ── Enqueue Unvisited Neighbours ─────────────────────────────────
        if (depth < maxDepth) {
          for (const link of normalizedLinks) {
            if (!visited.has(link) && stats.totalCrawled + queue.length < maxPages) {
              visited.add(link);
              queue.push({ url: link, depth: depth + 1 });
            }
          }
        }

        stats.totalLinks += normalizedLinks.length;
        stats.depthDistribution[depth] = (stats.depthDistribution[depth] || 0) + 1;

        console.log(
          `  ✅ [depth ${depth}] "${pageDoc.title.slice(0, 50)}" | links: ${normalizedLinks.length} | queue: ${queue.length}`
        );
      }
    } catch (err) {
      pageDoc.error      = err.message;
      pageDoc.statusCode = err.response?.status || 0;
      stats.totalErrors++;
      console.log(`  ❌ [depth ${depth}] ${url} → ${err.message}`);
    }

    // ── Persist to MongoDB ─────────────────────────────────────────────────
    try {
      await Page.findOneAndUpdate(
        { url: pageDoc.url },           // Match on URL (upsert)
        { $set: pageDoc },
        { upsert: true, new: true }
      );
    } catch (dbErr) {
      // Log but don't stop crawl for a single DB write failure
      console.error(`  💾 DB write failed for ${url}:`, dbErr.message);
    }

    stats.totalCrawled++;

    // Optional progress callback (e.g., for WebSocket streaming)
    if (typeof onProgress === "function") {
      onProgress({ ...stats, queueLength: queue.length });
    }
  }

  // ── Finalize Stats ─────────────────────────────────────────────────────────
  stats.finishedAt = new Date().toISOString();
  stats.durationMs = Date.now() - startTime;

  console.log(`\n📊 [${sessionId}] Crawl complete`);
  console.log(`   Crawled: ${stats.totalCrawled} | Errors: ${stats.totalErrors} | Links discovered: ${stats.totalLinks}`);
  console.log(`   Duration: ${(stats.durationMs / 1000).toFixed(2)}s\n`);

  return stats;
}

module.exports = { crawl, normalizeUrl };
