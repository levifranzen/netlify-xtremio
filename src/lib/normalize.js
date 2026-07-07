/**
 * normalize.js — string normalization for provider title matching
 *
 * Ported from the original Python implementation:
 *
 *   normalize_string() → normalize()
 *   clean_iptv_title() → cleanIptvTitle()
 *
 * normalize(str)
 *   Removes accents, lowercases, replaces & with e, drops everything
 *   except a-z and 0-9. Produces a deterministic slug.
 *
 *   "Breaking Bad"           → "breakingbad"
 *   "Tom & Jerry"            → "tomejerry"
 *   "Ação e Aventura"        → "acaoeaventura"
 *
 * cleanIptvTitle(str)
 *   Strips IPTV structural noise first, then normalizes.
 *   Used on provider titles when building/querying the index.
 *
 *   "Breaking Bad (2008)"          → "breakingbad"
 *   "Devoradores de Estrelas(2026)"→ "devoradoresdestrelas"
 *   "Breaking Bad [4K] [DUB]"      → "breakingbad"
 *   "BR: Breaking Bad"             → "breakingbad"
 */

// Compiled once for performance
// 1. Remove everything inside parentheses or brackets: (2026), [4K], [L], [CAM]
const RE_BRACKETS = /[\[(].*?[\])]/g;

// 2. Remove common loose IPTV tags not wrapped in brackets
const RE_TAGS = /\b(sd|hd|fhd|uhd|4k|8k|h265|hevc|cam|ts|tc|dub|dublado|leg|legendado|l|pt|br|ptbr|dual|audio|3d|vip|vod|alt)\b/gi;

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
    .normalize("NFD")                  // decompose accented chars: é → e + ́
    .replace(/[\u0300-\u036f]/g, "")   // strip combining marks
    .toLowerCase()
    .replace(/&/g, "e")                // & → e (e.g. "Tom & Jerry" → "tomejerry")
    .replace(/[^a-z0-9]/g, "")        // drop everything except letters/digits
    .trim();
}

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
  s = s.replace(RE_BRACKETS, "");  // remove (2026), [4K], [DUB]
  s = s.replace(RE_TAGS, "");      // remove loose tags
  return normalize(s);
}

module.exports = { normalize, cleanIptvTitle };
