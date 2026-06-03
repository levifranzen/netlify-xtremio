/**
 * load-background.js — /.netlify/functions/load-background
 *
 * Netlify Background Function (up to 15 min execution).
 * Builds and persists the Provider Index in Redis.
 *
 * POST { token }
 *
 * Writes:
 *   provider:{ph}:idx:movies  HASH  { "breaking bad" → [[1234, "2008"]] }
 *   provider:{ph}:idx:series  HASH  { "breaking bad" → [[9876, "2008"]] }
 *   provider:{ph}:idx:status  JSON  { state, movies, series, movieKeys, seriesKeys, ts }
 *
 * Returns:
 *   { movies, series, movieKeys, seriesKeys }
 */

const { verifyToken, hashApiKey, providerHash } = require("../../src/lib/token");
const { cache, keys, del, hsetBatch, hlen } = require("../../src/lib/cache");
const { XtreamClient } = require("../../src/lib/xtream");
const { normalize } = require("../../src/lib/normalize");

// TTL for index keys — 2h, longer than catalog (30min) so index outlives
// the raw catalog cache and doesn't need to be rebuilt as often.
const IDX_TTL = 60 * 60 * 2;

/**
 * Build a { normalizedTitle: [[id, year], ...] } map from a list of items.
 * Multiple items can share the same normalized title (e.g. remakes).
 *
 * @param {Array}  items    Raw list from Xtream (movies or series)
 * @param {string} idField  Field name for the stream/series ID
 * @param {string} yearField Field name for the release year
 */
function buildMap(items, idField, yearField) {
  const map = {};
  for (const item of items) {
    const title = normalize(item.name || item.title || "");
    if (!title) continue;

    const id   = item[idField];
    const year = item[yearField] ? String(item[yearField]).slice(0, 4) : null;

    if (!map[title]) map[title] = [];
    map[title].push([id, year]);
  }
  return map;
}

/**
 * Persist a map to a Redis HASH with TTL.
 * Deletes the existing key first to avoid stale fields from removed titles.
 */
async function persistIndex(key, map, ttl) {
  // 1. Delete old index to avoid stale entries
  await del(key);

  // 2. Write new index in batches of 50 HSET commands per pipeline call
  await hsetBatch(key, map, 50);

  // 3. Set TTL — separate command after all fields are written
  const { cmd } = require("../../src/lib/cache");
  await cmd("EXPIRE", key, ttl);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const { token } = body;
  if (!token) return { statusCode: 400, body: "Missing token" };

  // ── Auth (manual — token is in body, not URL path) ────────────────────────
  let payload;
  try { payload = verifyToken(token); } catch {
    return { statusCode: 401, body: "Invalid token" };
  }

  const { serverUrl, username, password, apiKey } = payload;
  const keyHash = hashApiKey(apiKey);
  const ph = providerHash(serverUrl);

  const keyData = await cache.getApiKey(keyHash).catch(() => null);
  if (!keyData || keyData.revoked) {
    return { statusCode: 403, body: "Revoked key" };
  }

  // ── Mark in-progress ──────────────────────────────────────────────────────
  await cache.setIdxStatus(ph, { state: "indexing", ts: Date.now() });

  const xtream = new XtreamClient(serverUrl, username, password);

  try {
    // ── Fetch catalogs ────────────────────────────────────────────────────────
    // These go through xtream.js which caches in Redis (30min TTL).
    // If the catalog cache is warm, these are Redis GETs — fast.
    // If cold, they hit the provider API once and populate cache.
    console.log(`[load] ${ph} — fetching catalogs`);
    const [movies, series] = await Promise.all([
      xtream.getMovies(),
      xtream.getSeries(),
    ]);
    console.log(`[load] ${ph} — movies: ${movies.length}, series: ${series.length}`);

    // ── Build in-memory maps ──────────────────────────────────────────────────
    // movies: stream_id + year field is "year" in Xtream VOD
    // series: series_id + releaseDate (we take first 4 chars)
    const movieMap  = buildMap(movies, "stream_id", "year");
    const seriesMap = buildMap(series, "series_id", "releaseDate");

    const movieKeys  = Object.keys(movieMap).length;
    const seriesKeys = Object.keys(seriesMap).length;
    console.log(`[load] ${ph} — unique movie titles: ${movieKeys}, series titles: ${seriesKeys}`);

    // ── Persist to Redis ──────────────────────────────────────────────────────
    console.log(`[load] ${ph} — persisting movie index`);
    await persistIndex(keys.idxMovies(ph), movieMap, IDX_TTL);

    console.log(`[load] ${ph} — persisting series index`);
    await persistIndex(keys.idxSeries(ph), seriesMap, IDX_TTL);

    // ── Final status ──────────────────────────────────────────────────────────
    const stats = { state: "done", movies: movies.length, series: series.length, movieKeys, seriesKeys, ts: Date.now() };
    await cache.setIdxStatus(ph, stats);
    console.log(`[load] ${ph} — done`, stats);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ movies: movies.length, series: series.length, movieKeys, seriesKeys }),
    };

  } catch (err) {
    console.error(`[load] ${ph} — error:`, err.message);
    await cache.setIdxStatus(ph, { state: "error", error: err.message, ts: Date.now() }).catch(() => {});
    return { statusCode: 500, body: err.message };
  }
};
