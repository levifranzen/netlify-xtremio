/**
 * load-background.js — /.netlify/functions/load-background
 *
 * Netlify Background Function (up to 15min execution).
 * Called fire-and-forget from configure.html after /configure succeeds.
 *
 * POST { token }
 *   → verifies token
 *   → pulls full movies + series from provider
 *   → builds inverted index in Redis:
 *       provider:{ph}:idx:movies  HSET { tmdb_id → stream_id, normalized_name → stream_id }
 *       provider:{ph}:idx:series  HSET { tmdb_id → stream_id, normalized_name → stream_id }
 *   → sets provider:{ph}:idx:status = { done, total, ts }
 *
 * TTL mirrors catalog (30min) — if catalog cache expires, index expires too
 * so the next /load call rebuilds both together.
 */

const { verifyToken, hashApiKey, providerHash } = require("../../src/lib/token");
const { cache, get, set } = require("../../src/lib/cache");
const { XtreamClient } = require("../../src/lib/xtream");

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const INDEX_TTL     = 60 * 30; // 30min — same as catalog

// ── Upstash HSET (multiple fields in one call) ────────────────────────────────
// Upstash REST: /hset/key/field1/value1/field2/value2/...
// Max URL length is a concern for 10k+ entries, so we batch.

async function hsetBatch(key, map) {
  const entries = Object.entries(map);
  if (entries.length === 0) return;

  const BATCH = 200; // fields per request
  for (let i = 0; i < entries.length; i += BATCH) {
    const slice = entries.slice(i, i + BATCH);
    const args = ["HSET", key, ...slice.flat()];
    const path = args.map(encodeURIComponent).join("/");
    await fetch(`${UPSTASH_URL}/${path}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
  }

  // Set TTL on the key after all fields are written
  await fetch(
    `${UPSTASH_URL}/${["EXPIRE", key, String(INDEX_TTL)].map(encodeURIComponent).join("/")}`,
    { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } }
  );
}

// ── Normalize name for fuzzy key ─────────────────────────────────────────────

function normalizeName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") // strip everything non-alphanumeric
    .trim();
}

// ── Status helpers ────────────────────────────────────────────────────────────

function statusKey(ph) { return `provider:${ph}:idx:status`; }

async function setStatus(ph, data) {
  return set(statusKey(ph), { ...data, ts: Date.now() }, INDEX_TTL);
}

// ── Main ──────────────────────────────────────────────────────────────────────

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

  // Verify token
  let payload;
  try { payload = verifyToken(token); } catch {
    return { statusCode: 401, body: "Invalid token" };
  }

  const { serverUrl, username, password, apiKey } = payload;
  const keyHash = hashApiKey(apiKey);
  const ph = providerHash(serverUrl);

  // Check key still valid
  const keyData = await cache.getApiKey(keyHash).catch(() => null);
  if (!keyData || keyData.revoked) {
    return { statusCode: 403, body: "Revoked key" };
  }

  // Mark as in-progress
  await setStatus(ph, { state: "indexing", movies: 0, series: 0 });

  const xtream = new XtreamClient(serverUrl, username, password);

  try {
    // ── Movies ──────────────────────────────────────────────────────────────
    console.log(`[load] ${ph} — fetching movies`);
    const movies = await xtream.getMovies();

    const movieIdx = {};
    for (const m of movies) {
      const sid = String(m.stream_id);
      // By TMDB ID
      if (m.tmdb_id) movieIdx[String(m.tmdb_id)] = sid;
      // By normalized name
      const norm = normalizeName(m.name);
      if (norm) movieIdx[norm] = sid;
      // By year+name composite for disambiguation
      if (norm && m.year) movieIdx[`${norm}${m.year}`] = sid;
    }

    await hsetBatch(`provider:${ph}:idx:movies`, movieIdx);
    console.log(`[load] ${ph} — movies indexed: ${movies.length}`);
    await setStatus(ph, { state: "indexing", movies: movies.length, series: 0 });

    // ── Series ───────────────────────────────────────────────────────────────
    console.log(`[load] ${ph} — fetching series`);
    const series = await xtream.getSeries();

    const seriesIdx = {};
    for (const s of series) {
      const sid = String(s.series_id);
      if (s.tmdb_id) seriesIdx[String(s.tmdb_id)] = sid;
      const norm = normalizeName(s.name);
      if (norm) seriesIdx[norm] = sid;
      if (norm && s.releaseDate) seriesIdx[`${norm}${s.releaseDate.slice(0, 4)}`] = sid;
    }

    await hsetBatch(`provider:${ph}:idx:series`, seriesIdx);
    console.log(`[load] ${ph} — series indexed: ${series.length}`);

    // ── Done ─────────────────────────────────────────────────────────────────
    await setStatus(ph, {
      state: "done",
      movies: movies.length,
      series: series.length,
    });

    console.log(`[load] ${ph} — index complete`);
    return { statusCode: 200, body: "OK" };

  } catch (err) {
    console.error(`[load] ${ph} — error:`, err.message);
    await setStatus(ph, { state: "error", error: err.message });
    return { statusCode: 500, body: err.message };
  }
};
