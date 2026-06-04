/**
 * load-background.js — /.netlify/functions/load-background
 *
 * Netlify Background Function (up to 15 min execution).
 * Builds and persists the Provider Index in Redis as HASH.
 *
 * POST { token }
 *
 * Writes:
 *   provider:{ph}:idx:movies  HASH  { "devoradoresdestrelas" → [[2806051, "2026"]] }
 *   provider:{ph}:idx:series  HASH  { "breakingbad" → [[9876, "2008"]] }
 *   provider:{ph}:idx:status  JSON  { state, movies, series, movieKeys, seriesKeys, ts }
 *
 * Returns:
 *   { movies, series, movieKeys, seriesKeys }
 */

const { verifyToken, hashApiKey, providerHash } = require("../../src/lib/token");
const { cache, keys, del, hsetBatch, cmd } = require("../../src/lib/cache");
const { XtreamClient } = require("../../src/lib/xtream");
const { cleanIptvTitle } = require("../../src/lib/normalize");

const IDX_TTL = 60 * 60 * 24 * 30; // 2h — outlives catalog cache (30 days)

/**
 * Build { normalizedTitle: [[id, year], ...] } map from provider list.
 * Multiple entries per title handle remakes / duplicates.
 */
function buildMap(items, idField, yearField) {
  const map = {};
  for (const item of items) {
    const title = cleanIptvTitle(item.name || item.title || "");
    if (!title) continue;

    const id   = item[idField];
    const year = item[yearField] ? String(item[yearField]).slice(0, 4) : null;

    if (!map[title]) map[title] = [];
    map[title].push([id, year]);
  }
  return map;
}

/**
 * Persist a map to Redis HASH with TTL.
 * Deletes existing key first to avoid stale entries from removed titles.
 */
async function persistIndex(key, map, ttl) {
  await del(key);
  await hsetBatch(key, map, 50);
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

  // ── Auth ──────────────────────────────────────────────────────────────────
  let payload;
  try { payload = verifyToken(token); } catch {
    return { statusCode: 401, body: "Invalid token" };
  }

  const { serverUrl, username, password, apiKey } = payload;
  const keyHash = hashApiKey(apiKey);
  const ph      = providerHash(serverUrl);

  const keyData = await cache.getApiKey(keyHash).catch(() => null);
  if (!keyData || keyData.revoked) {
    return { statusCode: 403, body: "Revoked key" };
  }

  await cache.setIdxStatus(ph, { state: "indexing", ts: Date.now() });

  const xtream = new XtreamClient(serverUrl, username, password);

  try {
    console.log(`[load] ${ph} — fetching catalogs`);
    const [movies, series] = await Promise.all([
      xtream.getMovies(),
      xtream.getSeries(),
    ]);
    console.log(`[load] ${ph} — movies: ${movies.length}, series: ${series.length}`);

    const movieMap  = buildMap(movies, "stream_id", "year");
    const seriesMap = buildMap(series, "series_id", "releaseDate");

    const movieKeys  = Object.keys(movieMap).length;
    const seriesKeys = Object.keys(seriesMap).length;
    console.log(`[load] ${ph} — unique titles: movies=${movieKeys}, series=${seriesKeys}`);

    console.log(`[load] ${ph} — persisting movie index`);
    await persistIndex(keys.idxMovies(ph), movieMap, IDX_TTL);

    console.log(`[load] ${ph} — persisting series index`);
    await persistIndex(keys.idxSeries(ph), seriesMap, IDX_TTL);

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
