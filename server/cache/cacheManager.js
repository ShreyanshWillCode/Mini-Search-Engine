/**
 * cacheManager.js — Redis-backed cache with graceful fallback
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides a namespaced, TTL-based cache on top of Redis.
 * If Redis is unavailable, every call is a no-op and search still works.
 *
 * Namespaces:
 *   search       — GET /api/search results          TTL: 5 min
 *   autocomplete — GET /api/autocomplete results     TTL: 2 min
 *   graph        — GET /api/graph results             TTL: 10 min
 *   stats        — GET /api/index/stats results      TTL: 1 min
 *
 * Key format:  "gravity:<namespace>:<key>"
 */

"use strict";

const { client, isReady } = require("../config/redisClient");

// ── TTL defaults (seconds) ────────────────────────────────────────────────────
const TTL = {
  search:       5 * 60,   //  5 minutes
  autocomplete: 2 * 60,   //  2 minutes
  graph:       10 * 60,   // 10 minutes
  stats:        1 * 60,   //  1 minute
};

const PREFIX = "gravity";

// ── Hit/miss counters (in-process metrics) ────────────────────────────────────
let hits   = 0;
let misses = 0;
let errors = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeKey(namespace, key) {
  return `${PREFIX}:${namespace}:${key}`;
}

// ── Core API ──────────────────────────────────────────────────────────────────

/**
 * get(namespace, key)
 * Fetches a cached value. Returns the parsed JS object, or null on miss/error.
 *
 * @param {string} namespace
 * @param {string} key
 * @returns {Promise<object|null>}
 */
async function get(namespace, key) {
  if (!isReady()) return null;
  try {
    const raw = await client.get(makeKey(namespace, key));
    if (raw === null) {
      misses++;
      return null;
    }
    hits++;
    return JSON.parse(raw);
  } catch (err) {
    errors++;
    console.error(`[Cache] GET error (${namespace}:${key}):`, err.message);
    return null;
  }
}

/**
 * set(namespace, key, value, ttlSeconds?)
 * Stores a value in Redis with optional TTL.
 * Defaults to the namespace TTL defined above.
 *
 * @param {string} namespace
 * @param {string} key
 * @param {object} value       — will be JSON-stringified
 * @param {number} [ttl]       — TTL in seconds (overrides namespace default)
 * @returns {Promise<void>}
 */
async function set(namespace, key, value, ttl) {
  if (!isReady()) return;
  const effectiveTtl = ttl || TTL[namespace] || 60;
  try {
    await client.set(makeKey(namespace, key), JSON.stringify(value), "EX", effectiveTtl);
  } catch (err) {
    errors++;
    console.error(`[Cache] SET error (${namespace}:${key}):`, err.message);
  }
}

/**
 * invalidate(namespace)
 * Deletes all keys under a given namespace using SCAN (non-blocking).
 * Called after crawl/reindex operations to flush stale data.
 *
 * @param {string} namespace
 * @returns {Promise<number>} Number of keys deleted
 */
async function invalidate(namespace) {
  if (!isReady()) return 0;
  const pattern = `${PREFIX}:${namespace}:*`;
  let deleted = 0;
  let cursor  = "0";

  try {
    do {
      const [nextCursor, keys] = await client.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await client.del(...keys);
        deleted += keys.length;
      }
    } while (cursor !== "0");

    console.log(`[Cache] Invalidated ${deleted} keys in namespace "${namespace}"`);
    return deleted;
  } catch (err) {
    errors++;
    console.error(`[Cache] INVALIDATE error (${namespace}):`, err.message);
    return 0;
  }
}

/**
 * invalidateAll()
 * Clears ALL gravity:* keys from Redis.
 * Called after a full index rebuild.
 *
 * @returns {Promise<number>}
 */
async function invalidateAll() {
  return invalidate(""); // pattern becomes "gravity:*" → catches all namespaces
}

/**
 * getMetrics()
 * Returns live cache performance statistics.
 * Exposed via GET /api/cache/stats
 *
 * @returns {Promise<object>}
 */
async function getMetrics() {
  const total   = hits + misses;
  const hitRate = total > 0 ? ((hits / total) * 100).toFixed(1) : "0.0";

  let redisInfo = { connected: isReady(), keyCount: 0, memoryUsed: "N/A" };

  if (isReady()) {
    try {
      // Count all gravity:* keys
      let keyCount = 0;
      let cursor   = "0";
      do {
        const [nextCursor, keys] = await client.scan(cursor, "MATCH", `${PREFIX}:*`, "COUNT", 100);
        cursor   = nextCursor;
        keyCount += keys.length;
      } while (cursor !== "0");

      // Get memory usage from INFO
      const info   = await client.info("memory");
      const match  = info.match(/used_memory_human:(.+)/);
      const memory = match ? match[1].trim() : "N/A";

      redisInfo = { connected: true, keyCount, memoryUsed: memory };
    } catch (err) {
      redisInfo = { connected: false, keyCount: 0, memoryUsed: "N/A" };
    }
  }

  return {
    hits,
    misses,
    errors,
    total,
    hitRate: `${hitRate}%`,
    ...redisInfo,
    ttlDefaults: TTL,
  };
}

module.exports = { get, set, invalidate, invalidateAll, getMetrics };
