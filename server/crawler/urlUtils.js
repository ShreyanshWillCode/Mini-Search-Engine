/**
 * urlUtils.js
 * ─────────────────────────────────────────────────────────────────────────────
 * URL normalisation and validation utilities for the web crawler.
 *
 * Responsibilities:
 *   1. Resolve relative URLs against a base URL
 *   2. Produce a canonical form (no trailing slash, no fragment, lowercase host)
 *   3. Filter out non-crawlable URLs (mailto:, javascript:, tel:, data:, …)
 *   4. Validate that a URL is a reachable HTTP/HTTPS address
 *
 * Why this matters (DSA / Graph context):
 *   Before we treat a URL as a graph node, we must normalise it so that
 *   these three strings are recognised as the SAME node:
 *     http://Example.com/page      (different protocol + mixed-case host)
 *     https://example.com/page/    (trailing slash)
 *     https://example.com/page#section  (fragment)
 *   All three canonicalise to: https://example.com/page
 *
 *   Normalisation steps applied (in order):
 *     1.  Trim whitespace
 *     2.  Reject fragment-only anchors (#...)
 *     3.  Expand protocol-relative URLs (//host → https://host)
 *     4.  Resolve relative paths  (URL constructor)
 *     5.  Reject blocked protocols (mailto:, javascript:, …)
 *     6.  Upgrade http → https   (canonical protocol)
 *     7.  Lowercase the hostname  (www.Example.com → www.example.com)
 *     8.  Remove the URL fragment (#section)
 *     9.  Remove trailing slash
 *     10. Reject blocked file extensions (.pdf, .jpg, …)
 *   Without ALL of these steps, the visited Set treats duplicate pages as
 *   distinct graph nodes and re-crawls them unnecessarily.
 */

const validUrl = require("valid-url");

// ─── Constants ────────────────────────────────────────────────────────────────

/** Protocols that are never crawlable web pages. */
const BLOCKED_PROTOCOLS = new Set([
  "mailto:",
  "javascript:",
  "tel:",
  "ftp:",
  "data:",
  "file:",
  "blob:",
  "about:",
  "chrome:",
  "chrome-extension:",
]);

/** File extensions we never want to crawl (binaries, media, documents). */
const BLOCKED_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".zip", ".tar", ".gz", ".rar", ".7z",
  ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".ico", ".bmp",
  ".mp3", ".mp4", ".wav", ".ogg", ".webm", ".avi",
  ".css", ".js", ".json", ".xml", ".rss", ".atom",
  ".exe", ".dmg", ".apk",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return the lowercase file extension of a URL pathname, or "" if none.
 * @param {URL} urlObj
 * @returns {string}
 */
function getExtension(urlObj) {
  const parts = urlObj.pathname.split(".");
  if (parts.length < 2) return "";
  return "." + parts[parts.length - 1].toLowerCase();
}

// ─── Core exports ─────────────────────────────────────────────────────────────

/**
 * normalizeUrl(href, baseUrl)
 * ─────────────────────────────────────────────────────────────────────────────
 * Resolve `href` against `baseUrl` and return the canonical URL string,
 * or `null` if the URL should be discarded.
 *
 * Normalisation steps applied:
 *   1.  Trim whitespace
 *   2.  Reject fragment-only anchors (#...)
 *   3.  Expand protocol-relative URLs (//example.com → https://example.com)
 *   4.  Resolve relative paths using the URL constructor
 *   5.  Reject blocked protocols (mailto:, javascript:, …)
 *   6.  Upgrade http → https  (canonical protocol — most sites serve the same
 *       content on both; treating them as identical avoids duplicate crawling)
 *   7.  Lowercase the hostname
 *   8.  Remove the URL fragment (#section)
 *   9.  Remove trailing slash from the path
 *   10. Reject blocked file extensions
 *
 * @param {string} href    - Raw href value from <a> tag
 * @param {string} baseUrl - URL of the page the href was found on
 * @returns {string|null}  - Canonical URL or null if not crawlable
 */
function normalizeUrl(href, baseUrl) {
  if (!href || typeof href !== "string") return null;

  href = href.trim();

  // 1. Skip empty and fragment-only refs
  if (!href || href === "#" || href.startsWith("#")) return null;

  try {
    const base = new URL(baseUrl);

    // 2. Expand protocol-relative URLs
    if (href.startsWith("//")) {
      href = base.protocol + href;
    }

    // 3. Resolve relative → absolute
    const resolved = new URL(href, baseUrl);

    // 5. Block non-HTTP protocols
    if (BLOCKED_PROTOCOLS.has(resolved.protocol)) return null;
    if (!["http:", "https:"].includes(resolved.protocol)) return null;

    // 6. Upgrade http → https (canonical protocol)
    //    Rationale: the vast majority of sites serve identical content on both.
    //    Normalising to https prevents the same page being crawled twice when
    //    discovered once via http:// link and once via https:// link.
    if (resolved.protocol === "http:") {
      resolved.protocol = "https:";
    }

    // 7. Lowercase hostname (www.Example.com → www.example.com)
    resolved.hostname = resolved.hostname.toLowerCase();

    // 8. Remove fragment
    resolved.hash = "";

    // 9. Remove trailing slash (canonical form)
    const canonical = resolved.href.replace(/\/$/, "");

    // 10. Skip blocked file types
    const ext = getExtension(resolved);
    if (BLOCKED_EXTENSIONS.has(ext)) return null;

    return canonical;
  } catch {
    // URL constructor threw — malformed URL
    return null;
  }
}

/**
 * isValidWebUrl(url)
 * ─────────────────────────────────────────────────────────────────────────────
 * Fast check: is this a well-formed http/https URL?
 * Uses the `valid-url` package for RFC-compliant validation.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isValidWebUrl(url) {
  if (!url || typeof url !== "string") return false;
  return !!validUrl.isWebUri(url);
}

/**
 * isSameDomain(url, seedUrl)
 * ─────────────────────────────────────────────────────────────────────────────
 * Returns true when `url` is on the same hostname as `seedUrl`.
 * Useful for "stay-on-domain" crawling mode.
 *
 * @param {string} url
 * @param {string} seedUrl
 * @returns {boolean}
 */
function isSameDomain(url, seedUrl) {
  try {
    return new URL(url).hostname === new URL(seedUrl).hostname;
  } catch {
    return false;
  }
}

module.exports = { normalizeUrl, isValidWebUrl, isSameDomain };
