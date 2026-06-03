/**
 * normalize.js — string normalization for provider title matching
 *
 * Goal: make titles from different sources comparable.
 *
 * Examples:
 *   "Breaking Bad"      → "breaking bad"
 *   "Breaking-Bad"      → "breaking bad"
 *   "Brèaking Bàd"      → "breaking bad"
 *   "  Breaking  Bad "  → "breaking bad"
 *   "Breaking.Bad.S01"  → "breaking bad s01"
 *
 * What we keep: letters (a-z), digits (0-9), spaces.
 * What we remove: accents, punctuation, extra whitespace.
 */

/**
 * Normalize a title string for comparison.
 * @param {string} str
 * @returns {string}
 */
function normalize(str) {
  if (!str || typeof str !== "string") return "";

  return str
    .normalize("NFD")                    // decompose accented chars: é → e + ́
    .replace(/[\u0300-\u036f]/g, "")     // strip accent combining marks
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")         // replace all non-alphanum with space
    .replace(/\s+/g, " ")                // collapse multiple spaces
    .trim();
}

module.exports = { normalize };
