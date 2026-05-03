/**
 * crawler.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Production-ready BFS Web Crawler — Stage 1 of the Mini Search Engine.
 *
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  DSA CONCEPTS USED                                          ║
 * ║  ─────────────────────────────────────────────────────────  ║
 * ║  Graph model  : URLs = nodes, hyperlinks = directed edges   ║
 * ║  BFS          : Level-order traversal (Queue-based)         ║
 * ║  Queue        : Custom O(1) FIFO  (see queue.js)           ║
 * ║  Visited Set  : O(1) duplicate lookup (JavaScript Set)      ║
 * ║  Adjacency list: stored as Page.links[] in MongoDB          ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * MODULAR DESIGN
 * ─────────────────────────────────────────────────────────────────────────────
 *  crawler.js  ← YOU ARE HERE  (BFS orchestration only)
 *  queue.js                    (custom Queue data structure)
 *  parser.js                   (HTML → title / content / links)
 *  urlUtils.js                 (URL normalisation & validation)
 *
 *  DB access is fully delegated to:
 *  ../services/storageService  (upsert, existence check, stats)
 *
 * BFS ALGORITHM (high level)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Init:  queue   ← [{ url: seedURL, depth: 0 }]
 *         visited ← Set { seedURL }
 *
 *  Loop (while queue not empty AND pages < maxPages):
 *    1. Dequeue { url, depth }
 *    2. Check DB — skip if already stored (dual-layer dedup)
 *    3. Fetch HTML via Axios (timeout-safe)
 *    4. Parse: title, content, links  (parser.js)
 *    5. Save to MongoDB (upsert)
 *    6. For each link  NOT in visited  AND  depth+1 ≤ maxDepth:
 *         visited.add(link)
 *         queue.enqueue({ url: link, depth: depth+1 })
 *    7. Optional delay between requests (polite crawling)
 */

const axios   = require("axios");
const Queue   = require("./queue");
const { parsePage }                       = require("./parser");
const { isValidWebUrl }                   = require("./urlUtils");
const { existsInDB, upsertPage, getTotalPageCount } = require("../services/storageService");
const indexQueue                          = require("../indexer/indexQueue");

// ─── Axios instance ───────────────────────────────────────────────────────────

/**
 * Pre-configured Axios instance used for every page fetch.
 * - Sets a polite User-Agent identifying our bot
 * - Enforces a hard timeout to avoid hanging on slow servers
 * - Follows up to 5 redirects
 */
const httpClient = axios.create({
  timeout: 10_000,
  maxRedirects: 5,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (compatible; MiniSearchBot/1.0; +https://github.com/you/mini-search)",
    Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
  },
  validateStatus: (status) => status >= 200 && status < 300,
});

// ─── Logger ───────────────────────────────────────────────────────────────────

/**
 * Structured, readable log lines prefixed with a crawler tag.
 * Keeps console output scannable during a long crawl.
 */
const log = {
  info:  (msg) => console.log  (`[Crawler] ℹ️  ${msg}`),
  ok:    (msg) => console.log  (`[Crawler] ✅ ${msg}`),
  warn:  (msg) => console.warn (`[Crawler] ⚠️  ${msg}`),
  error: (msg) => console.error(`[Crawler] ❌ ${msg}`),
  bfs:   (msg) => console.log  (`[BFS]     🔵 ${msg}`),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Pause execution for `ms` milliseconds.
 * Used between requests to be a polite crawler (avoids rate-limiting).
 * @param {number} ms
 * @returns {Promise<void>}
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch a URL and return the raw HTML string.
 * Returns null on any error (network, timeout, non-HTML content-type, etc.)
 *
 * @param {string} url
 * @returns {Promise<string|null>}
 */
async function fetchHtml(url) {
  try {
    const { data, headers } = await httpClient.get(url);

    // Only process HTML responses — skip PDFs, images, JSON APIs, etc.
    const contentType = headers["content-type"] || "";
    if (!contentType.includes("text/html")) {
      log.warn(`Non-HTML content-type at ${url} → skipping`);
      return null;
    }

    return typeof data === "string" ? data : null;
  } catch (err) {
    // Log meaningful error type without crashing the BFS loop
    if (err.code === "ECONNABORTED") {
      log.warn(`Timeout fetching ${url}`);
    } else if (err.response) {
      log.warn(`HTTP ${err.response.status} at ${url}`);
    } else {
      log.warn(`Network error at ${url} — ${err.message}`);
    }
    return null;
  }
}

// (DB helpers removed — use storageService.existsInDB / storageService.upsertPage)

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * runCrawler(options)
 * ─────────────────────────────────────────────────────────────────────────────
 * Starts a BFS crawl from the given seed URL.
 *
 * @param {object}  options
 * @param {string}  options.seedURL   - Starting URL (must be HTTP/HTTPS)
 * @param {number}  [options.maxDepth=2]  - Max BFS depth  (clamped 1–5)
 * @param {number}  [options.maxPages=50] - Max pages to crawl (clamped 1–200)
 * @param {number}  [options.delayMs=200] - Delay between requests in ms
 * @param {boolean} [options.sameDomain=false] - Restrict crawl to seed's domain
 *
 * @returns {Promise<{
 *   pagesCrawled: number,
 *   failed:       number,
 *   skipped:      number,
 *   pagesInDB:    number,
 *   duration:     number,
 *   status:       string
 * }>}
 */
async function runCrawler({
  seedURL,
  maxDepth  = 2,
  maxPages  = 50,
  delayMs   = 200,
  sameDomain = false,
}) {
  const startTime = Date.now();

  // ── Validate seed URL ────────────────────────────────────────────────────
  if (!isValidWebUrl(seedURL)) {
    throw new Error(`Invalid seed URL: "${seedURL}"`);
  }

  // ── Clamp parameters ─────────────────────────────────────────────────────
  // Enforce hard limits here too — crawler.js may be called directly from
  // tests or other code that bypasses the controller's clamping logic.
  maxDepth = Math.max(1, Math.min(5,   Number(maxDepth)  || 2));
  maxPages = Math.max(1, Math.min(200, Number(maxPages)  || 50));
  delayMs  = Math.max(0, Math.min(5_000, Number(delayMs) || 200));

  // Canonical form — no trailing slash
  const canonicalSeed = seedURL.replace(/\/$/, "");

  log.info(`Starting BFS crawl`);
  log.info(`Seed      : ${canonicalSeed}`);
  log.info(`Max depth : ${maxDepth}  (clamped 1–5)`);
  log.info(`Max pages : ${maxPages}  (clamped 1–200)`);
  log.info(`Delay     : ${delayMs}ms between requests  (clamped 0–5000)`);
  log.info(`Same domain only: ${sameDomain}`);
  log.info("─".repeat(60));

  // ── BFS Data Structures ──────────────────────────────────────────────────
  //
  //  queue   : Custom O(1) FIFO Queue  (see queue.js)
  //            Each item = { url: string, depth: number }
  //
  //  visited : JavaScript Set          O(1) add / has
  //            Tracks every URL we have ever enqueued — prevents the same URL
  //            from entering the queue multiple times.
  //
  //  Note: visited tracks ENQUEUED urls (not just crawled ones).
  //        This is the correct BFS pattern — mark a node visited when
  //        DISCOVERED, not when PROCESSED.

  const queue   = new Queue();
  const visited = new Set();

  // Push seed into queue and mark as visited
  queue.enqueue({ url: canonicalSeed, depth: 0 });
  visited.add(canonicalSeed);

  // Counters for stats
  let pagesCrawled = 0;
  let failed       = 0;
  let skipped      = 0;

  // ── BFS Loop ─────────────────────────────────────────────────────────────
  //
  //  This is the heart of the crawler — a standard BFS on a directed graph.
  //  The graph is implicit (we discover edges/links as we visit nodes/pages).
  //
  //  Termination conditions:
  //    a) Queue is empty      → graph fully traversed within depth limit
  //    b) pagesCrawled >= maxPages → budget exhausted

  while (!queue.isEmpty() && pagesCrawled < maxPages) {

    // ── Dequeue next node ─────────────────────────────────────────────────
    const { url, depth } = queue.dequeue();

    log.bfs(
      `Dequeued: ${url}  |  depth=${depth}  |  queue=${queue.size}  |  visited=${visited.size}  |  crawled=${pagesCrawled}`
    );

    // ── Dual-layer duplicate check ────────────────────────────────────────
    // Layer 1 (fast): visited Set — already checked when enqueuing
    // Layer 2 (safe): MongoDB    — catches URLs from previous crawl runs
    //                 (via storageService.existsInDB — no DB logic here)
    const alreadyStored = await existsInDB(url);
    if (alreadyStored) {
      log.info(`Already in DB — skipping: ${url}`);
      skipped++;
      continue;
    }

    // ── Fetch HTML ────────────────────────────────────────────────────────
    const html = await fetchHtml(url);
    if (!html) {
      failed++;
      continue;
    }

    // ── Parse page ────────────────────────────────────────────────────────
    // Delegated entirely to parser.js (Single Responsibility).
    // Wrapped in try-catch: malformed HTML can throw inside Cheerio.
    // Without this guard, one bad page would terminate the entire crawl.
    let title, content, links;
    try {
      ({ title, content, links } = parsePage(html, url));
    } catch (parseErr) {
      log.warn(`Parse failed for ${url}: ${parseErr.message}`);
      failed++;
      continue;
    }

    // ── Persist to MongoDB (via storageService) ───────────────────────────
    // storageService.upsertPage is the ONLY DB write in this pipeline.
    // It handles sanitisation, atomic upsert, duplicate key recovery,
    // and returns { status: 'inserted' | 'updated', docId } for observability.
    let docId;
    try {
      const saved = await upsertPage({ url, title, content, links, depth });
      docId = saved.docId;
      pagesCrawled++;
      log.ok(`[${saved.status.toUpperCase()}] [${pagesCrawled}/${maxPages}]  "${title}"  →  ${url}`);
    } catch (dbErr) {
      log.error(`DB save failed for ${url}: ${dbErr.message}`);
      failed++;
      continue;
    }

    // ── Queue page for incremental index update (non-blocking) ──────────
    // push() is O(1) synchronous — never blocks the BFS loop.
    // The queue flushes in the background in batches of 10 pages.
    // drain() is called after the loop to flush any remaining items.
    if (docId) {
      indexQueue.push({ _id: docId, url, title, content });
    }

    // ── Enqueue neighbours ────────────────────────────────────────────────
    //
    //  Only expand neighbours if we have not reached maxDepth.
    //  This is what limits how "deep" into the web graph we go.
    //
    //  For each outgoing link (edge in the graph):
    //    - Normalise it (urlUtils.js handles this at parse time)
    //    - If NOT in visited → mark visited + enqueue at depth+1
    //    - If already visited → skip (prevents cycles / infinite loops)

    if (depth < maxDepth) {
      let enqueuedCount = 0;

      for (const link of links) {
        // Optional same-domain filter
        if (sameDomain) {
          try {
            if (new URL(link).hostname !== new URL(canonicalSeed).hostname) {
              continue;
            }
          } catch {
            continue;
          }
        }

        if (!visited.has(link)) {
          visited.add(link);                      // mark as discovered (visited)
          queue.enqueue({ url: link, depth: depth + 1 }); // add to BFS queue
          enqueuedCount++;
        } else {
          skipped++;
        }
      }

      if (enqueuedCount > 0) {
        log.bfs(`Enqueued ${enqueuedCount} new link(s) from "${url}"`);
      }
    }

    // ── Polite delay ──────────────────────────────────────────────────────
    // Pause between requests to avoid hammering the target server.
    // Good practice — many sites rate-limit aggressive bots.
    if (delayMs > 0 && !queue.isEmpty()) {
      await delay(delayMs);
    }
  }

  // ── Drain index queue ─────────────────────────────────────────────────────
  // Flush all pages still pending in the queue before computing final stats.
  // This ensures the index reflects every page crawled in this run.
  try {
    await indexQueue.drain();
    const qs = indexQueue.stats;
    log.info(`Index queue drained — ${qs.totalFlushed} page(s) indexed in ${qs.flushCount} batch(es)`);
  } catch (idxErr) {
    log.warn(`Index drain error: ${idxErr.message}`);
  }

  // ── Final stats ───────────────────────────────────────────────────────────
  const duration  = Date.now() - startTime;
  const pagesInDB = await getTotalPageCount(); // via storageService

  log.info("─".repeat(60));
  log.info(`Crawl complete in ${(duration / 1000).toFixed(2)}s`);
  log.info(`Pages crawled : ${pagesCrawled}`);
  log.info(`Failed        : ${failed}`);
  log.info(`Skipped       : ${skipped}`);
  log.info(`Total in DB   : ${pagesInDB}`);

  return {
    pagesCrawled,
    failed,
    skipped,
    pagesInDB,
    duration,
    status: "completed",
  };
}

module.exports = { runCrawler };
