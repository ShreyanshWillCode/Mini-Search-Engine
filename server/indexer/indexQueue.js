/**
 * indexQueue.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Async in-memory batch queue for incremental, non-blocking index updates.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  HYBRID INDEXING STRATEGY                                                │
 * │                                                                          │
 * │  Problem:                                                                │
 * │    • Auto-index per-page  → index always fresh, but crawl slows down    │
 * │    • Manual rebuild only  → crawl stays fast, but results go stale      │
 * │                                                                          │
 * │  Solution (this module):                                                 │
 * │    • push(page) is synchronous and O(1) — never blocks the BFS loop     │
 * │    • A background flush loop batches N pages into ONE bulkWrite call     │
 * │    • Auto-flush triggers on: batchSize reached OR flushInterval elapsed  │
 * │    • drain() flushes all remaining items before a crawl result returns   │
 * │    • Full rebuild (POST /api/index/rebuild) is still available for       │
 * │      nightly resets and consistency recovery                             │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Usage (singleton pattern):
 *   const indexQueue = require("./indexQueue");
 *   indexQueue.push({ _id, url, title, content });  // O(1), non-blocking
 *   await indexQueue.drain();                        // at end of crawl
 *
 * Exported as a singleton so all callers share the same queue instance.
 */

"use strict";

const { indexBatch } = require("./indexBuilder");

// ── IndexQueue class ──────────────────────────────────────────────────────────

class IndexQueue {
  /**
   * @param {object} [opts]
   * @param {number} [opts.batchSize=10]        — flush when queue reaches this size
   * @param {number} [opts.flushIntervalMs=4000] — periodic flush interval
   */
  constructor({ batchSize = 10, flushIntervalMs = 4000 } = {}) {
    // Internal queue — plain array used as a FIFO buffer.
    // Array.push → O(1) amortised  (non-blocking for callers)
    // Array.splice(0, n) → O(n) for draining, acceptable at batch granularity
    this._queue = [];

    this._batchSize      = batchSize;
    this._flushIntervalMs = flushIntervalMs;

    // Guards against concurrent flush() calls overlapping
    this._flushing = false;

    // Stats for observability
    this._stats = { totalPushed: 0, totalFlushed: 0, totalErrors: 0, flushCount: 0 };

    // Start the periodic timer flush.
    // unref() tells Node.js this timer should NOT prevent the process from
    // exiting naturally — the queue drains on shutdown via drain() calls.
    this._timer = setInterval(() => this._flush("timer"), this._flushIntervalMs);
    if (this._timer.unref) this._timer.unref();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * push(pageData)
   * ─────────────────────────────────────────────────────────────────────────
   * Add one page to the queue. Synchronous — O(1) — never blocks the caller.
   *
   * If the queue reaches batchSize, a flush is triggered asynchronously
   * in the background (fire-and-forget from the caller's perspective).
   *
   * @param {{ _id|docId, url, title, content }} pageData
   */
  push(pageData) {
    this._queue.push(pageData);
    this._stats.totalPushed++;

    // Trigger a background flush when the batch is full.
    // This does NOT await — the BFS loop is never blocked.
    if (this._queue.length >= this._batchSize) {
      this._flush("batchSize").catch((err) => {
        console.warn("[IndexQueue] Background flush error:", err.message);
      });
    }
  }

  /**
   * drain()
   * ─────────────────────────────────────────────────────────────────────────
   * Flushes ALL remaining items synchronously.
   * Call this at the END of a crawl to ensure the index is fully up-to-date
   * before the crawl result is returned to the API caller.
   *
   * @returns {Promise<void>}
   */
  async drain() {
    // Keep flushing until the queue is empty
    while (this._queue.length > 0) {
      await this._flush("drain");
    }
  }

  /**
   * stats
   * Read-only snapshot of queue statistics.
   */
  get stats() {
    return { ...this._stats, pending: this._queue.length };
  }

  /**
   * stop()
   * Clear the background timer (call on graceful shutdown if needed).
   */
  stop() {
    clearInterval(this._timer);
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  /**
   * _flush(reason)
   * ─────────────────────────────────────────────────────────────────────────
   * Internal: dequeues up to batchSize pages and writes them to MongoDB
   * via indexBatch() — one bulkWrite for the entire batch.
   *
   * Re-entrant guard (_flushing flag) prevents two concurrent flushes
   * from stepping on each other.
   *
   * @param {string} reason — 'batchSize' | 'timer' | 'drain'  (for logging)
   */
  async _flush(reason) {
    // Re-entrant guard — only one flush at a time
    if (this._flushing || this._queue.length === 0) return;
    this._flushing = true;

    // Dequeue up to batchSize items — splice is O(batchSize) but not O(total)
    const batch = this._queue.splice(0, this._batchSize);

    try {
      const result = await indexBatch(batch);
      this._stats.totalFlushed += result.pagesIndexed;
      this._stats.flushCount   += 1;

      console.log(
        `[IndexQueue] ✓ Flushed ${result.pagesIndexed} page(s) ` +
        `(${result.wordsIndexed} ops) [${reason}] — ` +
        `${this._queue.length} pending`
      );
    } catch (err) {
      this._stats.totalErrors++;
      console.warn(`[IndexQueue] ✗ Flush failed [${reason}]: ${err.message}`);
      // Failed items are dropped — the full rebuild endpoint can recover them.
      // Alternatively: push back to queue (risk: retry loop on persistent error)
    } finally {
      this._flushing = false;
    }
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

/**
 * Export a single shared instance so all modules (crawler, controllers, etc.)
 * push to the same queue.
 *
 * Config:
 *   batchSize=10     — flush after every 10 pages (1 bulkWrite per 10 pages)
 *   flushInterval=4s — catches small batches that never hit batchSize
 *                      (e.g., a 3-page crawl would flush 4 seconds after)
 */
const indexQueue = new IndexQueue({ batchSize: 10, flushIntervalMs: 4000 });

module.exports = indexQueue;
