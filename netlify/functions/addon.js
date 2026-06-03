/**
 * addon.js — /.netlify/functions/addon/:token/{manifest,catalog,meta,stream,index-status}/...
 *
 * Single entry point for all Stremio addon resources.
 */

const { verifyToken, hashApiKey, providerHash } = require("../../src/lib/token");
const { cache, get } = require("../../src/lib/cache");
const { XtreamClient } = require("../../src/lib/xtream");
const { getMovieByImdbId, getSeriesByImdbId, movieToMeta, seriesToMeta } = require("../../src/lib/tmdb");

const PAGE_SIZE = 100;

// ── Index lookup (O(1) via Redis HGET) ───────────────────────────────────────

async function idxGet(key, field) {
  const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
  const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    const res = await fetch(
      `${UPSTASH_URL}/${["HGET", key, field].map(encodeURIComponent).join("/")}`,
      { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } }
    );
    if (!res.ok) return null;
    const { result } = await res.json();
    return result || null;
  } catch { return null; }
}

function normalizeName(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function json(statusCode, body, extra = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", ...extra },
    body: JSON.stringify(body),
  };
}

// ── Token auth ────────────────────────────────────────────────────────────────

async function authenticate(rawToken) {
  let payload;
  try { payload = verifyToken(rawToken); } catch { return null; }

  const { apiKey, serverUrl } = payload;
  const keyHash = hashApiKey(apiKey);
  const ph = providerHash(serverUrl);

  const [keyData, blocked] = await Promise.all([
    cache.getApiKey(keyHash).catch(() => null),
    cache.isProviderBlocked(ph).catch(() => false),
  ]);

  if (!keyData || keyData.revoked || blocked) return null;

  cache.incrStat(keyHash, "requests").catch(() => {});
  return { payload, keyHash, ph, xtream: new XtreamClient(payload.serverUrl, payload.username, payload.password) };
}

// ── Parse path ────────────────────────────────────────────────────────────────

function parsePath(path) {
  const stripped = path.replace(/^\/.netlify\/functions\/addon\/?/, "");
  const parts = stripped.split("/");
  return {
    token:    parts[0] || null,
    resource: parts[1] || null,
    type:     parts[2] || null,
    id:       (parts[3] || "").replace(/\.json$/, ""),
  };
}

// ── Manifest ──────────────────────────────────────────────────────────────────

function handleManifest(event, payload) {
  const host = `https://${event.headers.host}`;
  const { serverUrl } = payload;

  return json(200, {
    id: `com.xtremio.saas.${Buffer.from(serverUrl).toString("base64url").slice(0, 12)}`,
    version: "1.0.0",
    name: "Xtremio",
    description: "Your IPTV provider via Xtream Codes, powered by Xtremio SaaS",
    logo: `${host}/logo.png`,
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["tt", "xtream:"],
    catalogs: [
      { type: "movie",  id: "xtremio_movies", name: "IPTV Movies",  extra: [{ name: "genre" }, { name: "search" }] },
      { type: "series", id: "xtremio_series", name: "IPTV Series",  extra: [{ name: "genre" }, { name: "search" }] },
      { type: "tv",     id: "xtremio_live",   name: "IPTV Live TV", extra: [{ name: "genre" }] },
    ],
    behaviorHints: { adult: false, p2p: false },
  }, { "Cache-Control": "public, max-age=3600" });
}

// ── Catalog ───────────────────────────────────────────────────────────────────

async function handleCatalog(event, { xtream }) {
  const stripped = event.path.replace(/^\/.netlify\/functions\/addon\/[^/]+\/catalog\//, "");
  const parts = stripped.split("/");
  const type = parts[0];
  const extraStr = (parts[2] || parts[1] || "").replace(/\.json$/, "");
  const extra = {};
  extraStr.split("&").forEach(p => { const [k,v] = p.split("="); if (k&&v) extra[k] = decodeURIComponent(v); });
  const skip = parseInt(extra.skip || "0");
  const genre = extra.genre || null;
  const search = extra.search ? extra.search.toLowerCase() : null;

  try {
    let metas = [];

    if (type === "movie") {
      let items = await xtream.getMovies();
      if (genre) {
        const cats = await xtream.getCategories();
        const cat = cats.movies.find(c => c.category_name === genre);
        if (cat) items = items.filter(m => m.category_id == cat.category_id);
      }
      if (search) items = items.filter(m => m.name?.toLowerCase().includes(search));
      metas = items.slice(skip, skip + PAGE_SIZE).map(m => ({
        id: `xtream:movie:${m.stream_id}`,
        type: "movie", name: m.name, poster: m.stream_icon || null,
        releaseInfo: m.year ? String(m.year) : null,
      }));
    }

    else if (type === "series") {
      let items = await xtream.getSeries();
      if (genre) {
        const cats = await xtream.getCategories();
        const cat = cats.series.find(c => c.category_name === genre);
        if (cat) items = items.filter(s => s.category_id == cat.category_id);
      }
      if (search) items = items.filter(s => s.name?.toLowerCase().includes(search));
      metas = items.slice(skip, skip + PAGE_SIZE).map(s => ({
        id: `xtream:series:${s.series_id}`,
        type: "series", name: s.name, poster: s.cover || null,
        releaseInfo: s.releaseDate?.split("-")[0] || null,
      }));
    }

    else if (type === "tv") {
      let items = await xtream.getLiveStreams();
      if (genre) {
        const cats = await xtream.getCategories();
        const cat = cats.live.find(c => c.category_name === genre);
        if (cat) items = items.filter(s => s.category_id == cat.category_id);
      }
      if (search) items = items.filter(s => s.name?.toLowerCase().includes(search));
      metas = items.slice(skip, skip + PAGE_SIZE).map(s => ({
        id: `xtream:live:${s.stream_id}`, type: "tv",
        name: s.name, poster: s.stream_icon || null,
      }));
    }

    return json(200, { metas }, { "Cache-Control": "public, max-age=1800" });
  } catch (err) {
    console.error("[catalog]", err.message);
    return json(500, { error: err.message });
  }
}

// ── Meta ──────────────────────────────────────────────────────────────────────

async function handleMeta(event, { xtream }) {
  const stripped = event.path.replace(/^\/.netlify\/functions\/addon\/[^/]+\/meta\//, "");
  const parts = stripped.split("/");
  const type = parts[0];
  const id = (parts[1] || "").replace(/\.json$/, "");

  try {
    if (id.startsWith("tt")) {
      if (type === "movie") {
        const tmdb = await getMovieByImdbId(id);
        return json(200, { meta: movieToMeta(id, null, tmdb) });
      }
      if (type === "series") {
        const tmdb = await getSeriesByImdbId(id);
        return json(200, { meta: seriesToMeta(id, null, tmdb) });
      }
    }

    const [, itemType, itemId] = id.split(":");

    if (itemType === "movie") {
      const info = await xtream.getMovieInfo(itemId);
      const m = info?.info || {};
      return json(200, { meta: {
        id, type: "movie", name: m.name || "Unknown",
        poster: m.movie_image || null, description: m.plot || null,
        releaseInfo: m.releasedate?.split("-")[0] || null,
        imdbRating: m.rating_5based ? String((m.rating_5based * 2).toFixed(1)) : null,
        genres: m.genre ? m.genre.split(",").map(g => g.trim()) : [],
      }});
    }

    if (itemType === "series") {
      const info = await xtream.getSeriesInfo(itemId);
      const s = info?.info || {};
      const videos = [];
      for (const [season, eps] of Object.entries(info?.episodes || {})) {
        for (const ep of eps) {
          videos.push({
            id: `xtream:ep:${ep.id}`,
            title: ep.title || `Episode ${ep.episode_num}`,
            season: parseInt(season), episode: parseInt(ep.episode_num),
            released: ep.added ? new Date(parseInt(ep.added) * 1000).toISOString() : null,
          });
        }
      }
      return json(200, { meta: {
        id, type: "series", name: s.name || "Unknown",
        poster: s.cover || null, description: s.plot || null,
        releaseInfo: s.releaseDate?.split("-")[0] || null,
        videos: videos.sort((a, b) => a.season - b.season || a.episode - b.episode),
      }});
    }

    if (itemType === "live") {
      const streams = await xtream.getLiveStreams();
      const s = streams.find(x => String(x.stream_id) === String(itemId));
      return json(200, { meta: { id, type: "tv", name: s?.name || `Channel ${itemId}`, poster: s?.stream_icon || null }});
    }

    return json(404, { error: "Unknown ID" });
  } catch (err) {
    console.error("[meta]", err.message);
    return json(500, { error: err.message });
  }
}

// ── Stream ────────────────────────────────────────────────────────────────────

async function handleStream(event, { xtream, keyHash, ph }) {
  const stripped = event.path.replace(/^\/.netlify\/functions\/addon\/[^/]+\/stream\//, "");
  const parts = stripped.split("/");
  const type = parts[0];
  const id = (parts[1] || "").replace(/\.json$/, "");

  try {
    let streams = [];

    // tt{imdbId}:season:episode — Stremio series format
    const ttSeries = id.match(/^(tt\d+):(\d+):(\d+)$/);
    if (ttSeries) {
      const [, imdbId, season, episode] = ttSeries;
      const tmdbId = imdbId.replace("tt", "");

      // 1. Index lookup O(1)
      let seriesId = await idxGet(`provider:${ph}:idx:series`, tmdbId);

      // 2. Try alternate tmdb: prefix key
      if (!seriesId) seriesId = await idxGet(`provider:${ph}:idx:series`, `tmdb:${tmdbId}`);

      // 3. Fallback: TMDB name → normalized name in index
      if (!seriesId) {
        const tmdb = await getSeriesByImdbId(imdbId);
        if (tmdb) {
          seriesId = await idxGet(`provider:${ph}:idx:series`, String(tmdb.id));
          if (!seriesId) seriesId = await idxGet(`provider:${ph}:idx:series`, normalizeName(tmdb.name));
          // Last resort: full list scan
          if (!seriesId) {
            const all = await xtream.getSeries();
            const match = all.find(s => s.tmdb_id == tmdb.id || normalizeName(s.name) === normalizeName(tmdb.name));
            if (match) seriesId = String(match.series_id);
          }
        }
      }

      if (seriesId) {
        const info = await xtream.getSeriesInfo(seriesId);
        const eps = info?.episodes?.[String(season)] || [];
        const ep = eps.find(e => String(e.episode_num) === String(episode));
        if (ep) {
          streams = [
            { url: xtream.getEpisodeStreamUrl(ep.id, "mkv"), title: "MKV" },
            { url: xtream.getEpisodeStreamUrl(ep.id, "mp4"), title: "MP4" },
          ];
        }
      }
      cache.incrStat(keyHash, "streams_series").catch(() => {});
    }

    // tt{imdbId} movie
    else if (id.startsWith("tt") && type === "movie") {
      const tmdbId = id.replace("tt", "");

      // 1. Index lookup O(1)
      let streamId = await idxGet(`provider:${ph}:idx:movies`, tmdbId);

      // 2. Fallback: list scan
      if (!streamId) {
        const movies = await xtream.getMovies();
        const match = movies.find(m => String(m.tmdb_id) === tmdbId);
        if (match) streamId = String(match.stream_id);
      }

      if (streamId) {
        streams = [
          { url: xtream.getMovieStreamUrl(streamId, "mp4"), title: "MP4" },
          { url: xtream.getMovieStreamUrl(streamId, "mkv"), title: "MKV" },
        ];
      }
      cache.incrStat(keyHash, "streams_movie").catch(() => {});
    }

    // xtream: native IDs
    else {
      const [, itemType, itemId] = id.split(":");
      if (itemType === "movie") {
        streams = [
          { url: xtream.getMovieStreamUrl(itemId, "mp4"), title: "MP4" },
          { url: xtream.getMovieStreamUrl(itemId, "mkv"), title: "MKV" },
        ];
        cache.incrStat(keyHash, "streams_movie").catch(() => {});
      } else if (itemType === "ep") {
        streams = [
          { url: xtream.getEpisodeStreamUrl(itemId, "mkv"), title: "MKV" },
          { url: xtream.getEpisodeStreamUrl(itemId, "mp4"), title: "MP4" },
        ];
        cache.incrStat(keyHash, "streams_series").catch(() => {});
      } else if (itemType === "live") {
        streams = [
          { url: xtream.getLiveStreamUrl(itemId, "m3u8"), title: "HLS" },
          { url: xtream.getLiveStreamUrl(itemId, "ts"),   title: "TS" },
        ];
        cache.incrStat(keyHash, "streams_live").catch(() => {});
      }
    }

    if (streams.length === 0) return json(200, { streams: [] });
    return json(200, { streams }, { "Cache-Control": "public, max-age=300" });

  } catch (err) {
    console.error("[stream]", err.message);
    return json(500, { error: err.message });
  }
}

// ── Index status ──────────────────────────────────────────────────────────────

async function handleIndexStatus(event, { ph }) {
  const status = await get(`provider:${ph}:idx:status`).catch(() => null);
  return json(200, status || { state: "not_started" });
}

// ── Main handler ──────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*" }, body: "" };
  }

  const { token, resource } = parsePath(event.path);
  if (!token) return json(400, { error: "Missing token" });

  const auth = await authenticate(token);
  if (!auth) return json(401, { error: "Invalid token or revoked key" });

  switch (resource) {
    case "manifest":      return handleManifest(event, auth.payload);
    case "catalog":       return handleCatalog(event, auth);
    case "meta":          return handleMeta(event, auth);
    case "stream":        return handleStream(event, auth);
    case "index-status":  return handleIndexStatus(event, auth);
    default:              return json(404, { error: `Unknown resource: ${resource}` });
  }
};
