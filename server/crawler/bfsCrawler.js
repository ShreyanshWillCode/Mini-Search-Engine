/**
 * bfsCrawler.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Core BFS web-crawler.
 *
 * Data-structure mapping:
 *   Queue      → simple array used with push() / shift()  (O(1) amortised)
 *   Visited    → JavaScript Set                           (O(1) lookup)
 *   Adj. list  → stored per-document in Page.links[]
 *
 * Algorithm:
 *   1. Enqueue { url: seedURL, depth: 0 }
 *   2. Mark seedURL as visited
 *   3. Dequeue node
 *   4. Fetch + parse HTML
 *   5. Extract title, text, hrefs
 *   6. Persist to MongoDB (upsert avoids duplicate-key errors)
 *   7. For each extracted href that is not yet visited and depth+1 ≤ maxDepth
 *        → mark visited, enqueue { url: href, depth: depth+1 }
 *   8. Repeat from step 3 until queue empty or page limit reached
 */

const axios = require("axios");
const cheerio = require("cheerio");
const validUrl = require("valid-url");
const Page = require("../models/Page");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve a potentially relative href against the current page origin.
 * Returns null when the href is non-HTTP (mailto:, javascript:, #fragment …).
 */
function resolveHref(href, baseUrl) {
  if (!href) return null;

  // Strip fragment-only anchors
  if (href.startsWith("#")) return null;

  try {
    const base = new URL(baseUrl);

    // Handle protocol-relative URLs
    if (href.startsWith("//")) {
      href = base.protocol + href;
    }

    const resolved = new URL(href, baseUrl);

    // Accept only http / https
    if (!["http:", "https:"].includes(resolved.protocol)) return null;

    // Remove trailing slash for canonical form
    return resolved.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

/**
 * Fetch a URL with a timeout and return the raw HTML string.
 * Returns null on any network / HTTP error.
 */
async function fetchPage(url, timeoutMs = 10_000) {
  try {
    const { data, headers } = await axios.get(url, {
      timeout: timeoutMs,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; MiniSearchBot/1.0; +https://github.com/you/mini-search)",
        Accept: "text/html,application/xhtml+xml",
      },
      maxRedirects: 5,
      // Only accept text/html responses
      validateStatus: (s) => s >= 200 && s < 300,
    });

    const contentType = headers["content-type"] || "";
    if (!contentType.includes("text/html")) return null;

    return typeof data === "string" ? data : null;
  } catch {
    return null;
  }
}

/**
 * Parse HTML with cheerio and extract title, clean text, and absolute hrefs.
 */
function parsePage(html, currentUrl) {
  const $ = cheerio.load(html);

  // Title
  const title = $("title").first().text().trim() || "No title";

  // Clean body text – remove scripts, styles, nav, footer noise
  $("script, style, noscript, nav, footer, aside, header, iframe").remove();
  const content = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 5_000); // cap at 5 000 chars

  // Extract and resolve all hrefs
  const links = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    const resolved = resolveHref(href, currentUrl);
    if (resolved && validUrl.isWebUri(resolved)) {
      links.push(resolved);
    }
  });

  // Deduplicate within the page itself
  const uniqueLinks = [...new Set(links)];

  return { title, content, links: uniqueLinks };
}

// ─── Main crawler export ──────────────────────────────────────────────────────

/**
 * runCrawler({ seedURL, maxDepth, maxPages })
 *
 * @param {string} seedURL   - Starting URL
 * @param {number} maxDepth  - Maximum BFS depth (default 2)
 * @param {number} maxPages  - Maximum pages to crawl (default 50)
 *
 * @returns {Promise<{
 *   crawled: number,
 *   failed: number,
 *   skipped: number,
 *   pagesInDB: number,
 *   duration: number   // ms
 * }>}
 */
async function runCrawler({
  seedURL,
  maxDepth = 2,
  maxPages = 50,
}) {
  const startTime = Date.now();

  // ── Sanitise seed URL ────────────────────────────────────────────────────
  if (!validUrl.isWebUri(seedURL)) {
    throw new Error(`Invalid seed URL: "${seedURL}"`);
  }
  // Canonical form (no trailing slash)
  seedURL = seedURL.replace(/\/$/, "");

  // ── BFS data structures ──────────────────────────────────────────────────
  // Each queue item: { url: string, depth: number }
  const queue = [{ url: seedURL, depth: 0 }];
  const visited = new Set([seedURL]); // O(1) lookup

  let crawled = 0;
  let failed = 0;
  let skipped = 0;

  // ── BFS loop ─────────────────────────────────────────────────────────────
  while (queue.length > 0 && crawled + failed < maxPages) {
    const { url, depth } = queue.shift(); // Dequeue (FIFO)

    // 1. Fetch HTML
    const html = await fetchPage(url);
    if (!html) {
      failed++;
      continue;
    }

    // 2. Parse
    const { title, content, links } = parsePage(html, url);

    // 3. Persist (upsert so re-runs don't throw duplicate-key errors)
    try {
      await Page.findOneAndUpdate(
        { url },
        { url, title, content, links, depth, crawledAt: new Date() },
        { upsert: true, new: true, runValidators: true }
      );
      crawled++;
    } catch (dbErr) {
      console.error(`DB error saving ${url}: ${dbErr.message}`);
      failed++;
      continue;
    }

    // 4. Enqueue unvisited neighbours (only if depth allows)
    if (depth < maxDepth) {
      for (const link of links) {
        if (!visited.has(link)) {
          visited.add(link);
          queue.push({ url: link, depth: depth + 1 });
        } else {
          skipped++;
        }
      }
    }
  }

  const duration = Date.now() - startTime;
  const pagesInDB = await Page.countDocuments();

  return { crawled, failed, skipped, pagesInDB, duration };
}

module.exports = { runCrawler };
