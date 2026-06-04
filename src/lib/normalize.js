/**
 * normalize.js — string normalization for provider title matching
 *
 * Two functions:
 *
 * cleanIptvTitle(str)
 *   Removes IPTV structural noise before normalization:
 *   - year/tags in parentheses/brackets: (2026), [4K], [DUB]
 *   - common loose IPTV tags: HD, FHD, 4K, DUB, DUBLADO, BR, PT, etc.
 *   Used when building the provider index so titles like
 *   "Breaking Bad (2008)" and "Breaking Bad" get the same key.
 *
 * normalize(str)
 *   Converts to a compact slug with no spaces — deterministic key.
 *   Used on both sides of a match (provider title and TMDB title).
 *
 * Examples:
 *   "Breaking Bad (2008)"          → "breakingbad"
 *   "Devoradores de Estrelas(2026)"→ "devoradoresdestrelas"
 *   "Breaking Bad [4K] [DUB]"      → "breakingbad"
 *   "BR: Breaking Bad"             → "breakingbad"   (prefix stripped)
 *   "Project Hail Mary"            → "projecthailmary"
 */

// Compiled once — applied in cleanIptvTitle
const RE_BRACKETS  = /[\[(].*?[\])]/g;
const RE_COUNTRY_PREFIX = /^[a-z]{2,4}:\s*/i;
const RE_IPTV_TAGS = /\b(sd|hd|fhd|uhd|4k|8k|h265|hevc|cam|ts|tc|dub|dublado|leg|legendado|ptbr|pt|br|dual|audio|3d|vip|vod|alt|multi)\b/gi;

/**
 * Strip IPTV noise from a raw provider title, then normalize.
 * Use this when building or querying the provider index.
 *
 * @param {string} str
 * @returns {string}
 */
function cleanIptvTitle(str) {
  if (!str || typeof str !== "string") return "";

  let s = str;
  s = s.replace(RE_BRACKETS, "");        // remove (2026), [4K], [DUB]
  s = s.replace(RE_COUNTRY_PREFIX, "");  // remove "BR: ", "US: ", "PT: "
  s = s.replace(RE_IPTV_TAGS, "");       // remove loose tags
  return normalize(s);
}

/**
 * Normalize a string into a compact, comparable slug.
 * No spaces — deterministic key suitable for Redis HASH fields.
 *
 * @param {string} str
 * @returns {string}
 */
function normalize(str) {
  if (!str || typeof str !== "string") return "";

  return str
    .normalize("NFD")                   // decompose accented chars: é → e + ́
    .replace(/[\u0300-\u036f]/g, "")    // strip combining marks
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")          // drop everything except letters/digits
    .trim();
}

module.exports = { normalize, cleanIptvTitle };
