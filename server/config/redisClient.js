/**
 * redisClient.js — Redis connection singleton using ioredis
 * ─────────────────────────────────────────────────────────────────────────────
 * Creates a single shared ioredis client for the entire application.
 * All modules should import this file rather than creating their own client.
 *
 * Features:
 *   - Auto-reconnect with exponential backoff (built into ioredis)
 *   - Graceful degradation: if Redis is unavailable, isReady stays false
 *     and the cache module falls back to a no-op (search still works)
 *   - Configurable via REDIS_URL env variable (defaults to localhost:6379)
 */

"use strict";

const Redis = require("ioredis");

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

const client = new Redis(REDIS_URL, {
  // Retry strategy: exponential backoff, give up after 10 attempts
  retryStrategy(times) {
    if (times > 10) {
      console.warn("[Redis] Max reconnect attempts reached. Cache disabled.");
      return null; // Stop retrying
    }
    const delay = Math.min(times * 100, 3000);
    return delay;
  },
  // Don't crash the server if Redis is not available at startup
  lazyConnect:           false,
  enableOfflineQueue:    false, // Don't queue commands when disconnected
  maxRetriesPerRequest:  1,
});

// ── Connection events ─────────────────────────────────────────────────────────

client.on("connect", () => {
  console.log(`[Redis] ✅  Connected to ${REDIS_URL}`);
});

client.on("ready", () => {
  console.log("[Redis] 🚀  Client ready — caching active");
});

client.on("error", (err) => {
  // Only log once per type to avoid log spam during reconnect cycles
  if (err.code !== "ECONNREFUSED" && err.code !== "ENOTFOUND") {
    console.error("[Redis] Error:", err.message);
  }
});

client.on("close", () => {
  console.warn("[Redis] ⚠️  Connection closed");
});

// ── Utility helpers ───────────────────────────────────────────────────────────

/**
 * isReady()
 * Returns true only when the client is fully connected and operational.
 * Use this before issuing commands to gracefully skip when Redis is down.
 */
function isReady() {
  return client.status === "ready";
}

module.exports = { client, isReady };
