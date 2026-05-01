/**
 * parser.js
 * ─────────────────────────────────────────────────────────────────────────────
 * HTML parsing module powered by Cheerio (server-side jQuery).
 *
 * Responsibilities:
 *   1. Extract the page <title>
 *   2. Extract clean, readable body text (strip boilerplate HTML noise)
 *   3. Extract and normalise all outgoing <a href=""> links
 *
 * Why separate this from the crawler?
 *   Single Responsibility Principle — the crawler should only manage BFS
 *   traversal logic. Parsing is an independent concern and can be tested,
 *   swapped (e.g., use Puppeteer for JS-rendered pages), or extended
 *   (e.g., extract meta tags, images, headers) without touching the crawler.
 */

const cheerio = require("cheerio");
const { normalizeUrl, isValidWebUrl } = require("./urlUtils");

// ─── Constants ────────────────────────────────────────────────────────────────

/** Max characters to store from body text. Keeps MongoDB documents lean. */
const MAX_CONTENT_LENGTH = 5_000;

/**
 * HTML elements that contain navigation/structural noise rather than
 * meaningful content. Removed before extracting body text.
 */
const NOISE_SELECTORS =
  "script, style, noscript, nav, footer, aside, header, iframe, " +
  "form, button, [aria-hidden='true'], .cookie-banner, #cookie-notice";

// ─── Exports ──────────────────────────────────────────────────────────────────

/**
 * parsePage(html, pageUrl)
 * ─────────────────────────────────────────────────────────────────────────────
 * Parse a raw HTML string and return structured page data.
 *
 * @param {string} html    - Raw HTML string fetched from the network
 * @param {string} pageUrl - Absolute URL of the page (used to resolve hrefs)
 *
 * @returns {{
 *   title:   string,   // <title> tag text (falls back to first <h1>)
 *   content: string,   // cleaned body text, capped at MAX_CONTENT_LENGTH
 *   links:   string[]  // deduplicated, normalised absolute URLs
 * }}
 */
function parsePage(html, pageUrl) {
  const $ = cheerio.load(html);

  // ── 1. Title ───────────────────────────────────────────────────────────────
  // Primary source: <title> tag.
  // Fallback: first <h1> (common when <title> is empty or generic).
  let title =
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    "No title";

  // Collapse excessive whitespace from multi-line titles
  title = title.replace(/\s+/g, " ").trim();

  // ── 2. Content (clean body text) ──────────────────────────────────────────
  // Remove noisy structural elements that add no searchable value
  $(NOISE_SELECTORS).remove();

  const content = $("body")
    .text()
    .replace(/\s+/g, " ") // collapse all whitespace to single spaces
    .trim()
    .slice(0, MAX_CONTENT_LENGTH);

  // ── 3. Links ───────────────────────────────────────────────────────────────
  // Collect every <a href="..."> on the page,
  // normalise each one relative to the current pageUrl,
  // and deduplicate using a Set.
  const rawLinks = new Set();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    const normalized = normalizeUrl(href, pageUrl);
    if (normalized && isValidWebUrl(normalized)) {
      rawLinks.add(normalized);
    }
  });

  const links = [...rawLinks];

  return { title, content, links };
}

module.exports = { parsePage };
