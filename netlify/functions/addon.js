/**
 * addon.js — /.netlify/functions/addon/:token/{manifest,catalog,meta,stream}/...
 *
 * Single Netlify Function handling all Stremio addon resources.
 * Provider index removed for MVP — stream lookup uses cached catalog list.
 */

const { verifyToken, hashApiKey, providerHash } = require("../../src/lib/token");
const { cache } = require("../../src/lib/cache");
const { XtreamClient } = require("../../src/lib/xtream");
const { getMovieByImdbId, getSeriesByImdbId, getMatchNames, movieToMeta, seriesToMeta } = require("../../src/lib/tmdb");
const { normalize, cleanIptvTitle } = require("../../src/lib/normalize");

const PAGE_SIZE = 100;

function json(statusCode, body, extra = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", ...extra },
    body: JSON.stringify(body),
  };
}

// ── Auth ──────────────────────────────────────────────────────────────────────

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

// ── Path parsing ──────────────────────────────────────────────────────────────

function parsePath(path) {
  const stripped = path.replace(/^\/.netlify\/functions\/addon\/?/, "");
  const parts = stripped.split("/");
  return {
    token:    parts[0] || null,
    resource: (parts[1] || "").replace(/\.json$/, ""),
  };
}

// ── Manifest ──────────────────────────────────────────────────────────────────

function handleManifest(event, payload) {
  const host = `https://${event.headers.host}`;
  const { token } = parsePath(event.path);

  const manifest = {
    id: `com.xtremio.saas.${Buffer.from(payload.serverUrl).toString("base64url").slice(0, 12)}`,
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
  };

  return json(200, manifest, { "Cache-Control": "public, max-age=3600" });
}

// ── Catalog ───────────────────────────────────────────────────────────────────

async function handleCatalog(event, { xtream }) {
  const stripped = event.path.replace(/^\/.netlify\/functions\/addon\/[^/]+\/catalog\//, "");
  const parts = stripped.split("/");
  const type = parts[0];

  // Extra params: genre=Action or search=batman encoded in last segment
  const extraStr = (parts[2] || parts[1] || "").replace(/\.json$/, "");
  const extra = {};
  extraStr.split("&").forEach(p => {
    const [k, v] = p.split("=");
    if (k && v !== undefined) extra[k] = decodeURIComponent(v);
  });

  const skip   = parseInt(extra.skip || "0");
  const genre  = extra.genre || null;
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
        id: `xtream:live:${s.stream_id}`,
        type: "tv", name: s.name, poster: s.stream_icon || null,
      }));
    }

    return json(200, { metas }, { "Cache-Control": "public, max-age=1800" });
  } catch (err) {
    console.error("[catalog]", err.message);
    return json(500, { error: err.message });
  }
}

// ── Meta ──────────────────────────────────────────────────────────────────────

function buildVideos(info) {
  const videos = [];
  for (const [season, eps] of Object.entries(info?.episodes || {})) {
    for (const ep of eps) {
      videos.push({
        id:       `xtream:ep:${ep.id}`,
        title:    ep.title || `Episode ${ep.episode_num}`,
        season:   parseInt(season),
        episode:  parseInt(ep.episode_num),
        released: ep.added ? new Date(parseInt(ep.added) * 1000).toISOString() : null,
        overview:  ep.info?.plot || null,
        thumbnail: ep.info?.movie_image || null,
      });
    }
  }
  return videos.sort((a, b) => a.season - b.season || a.episode - b.episode);
}

async function handleMeta(event, { xtream }) {
  const stripped = event.path.replace(/^\/.netlify\/functions\/addon\/[^/]+\/meta\//, "");
  const parts = stripped.split("/");
  const type = parts[0];
  const id   = (parts[1] || "").replace(/\.json$/, "");

  try {
    // IMDb IDs — enrich via TMDB
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
      const info  = await xtream.getMovieInfo(itemId);
      const m     = info?.info || {};
      const mdata = info?.movie_data || {};
      return json(200, { meta: {
        id, type: "movie",
        name:        m.name || mdata.name || "Unknown",
        poster:      m.movie_image || null,
        background:  m.backdrop_path?.[0] ? `https://image.tmdb.org/t/p/w1280${m.backdrop_path[0]}` : null,
        description: m.plot || null,
        releaseInfo: m.releasedate?.split("-")[0] || null,
        imdbRating:  m.rating_5based ? String((m.rating_5based * 2).toFixed(1)) : null,
        runtime:     m.duration || null,
        genres:      m.genre ? m.genre.split(",").map(g => g.trim()) : [],
        cast:        m.cast ? m.cast.split(",").map(c => c.trim()) : [],
        director:    m.director ? [m.director] : [],
      }});
    }

    if (itemType === "series") {
      const info = await xtream.getSeriesInfo(itemId);
      const s    = info?.info || {};
      return json(200, { meta: {
        id, type: "series",
        name:        s.name || "Unknown",
        poster:      s.cover || null,
        background:  s.backdrop_path?.[0] ? `https://image.tmdb.org/t/p/w1280${s.backdrop_path[0]}` : null,
        description: s.plot || null,
        releaseInfo: s.releaseDate?.split("-")[0] || null,
        imdbRating:  s.rating_5based ? String((s.rating_5based * 2).toFixed(1)) : null,
        genres:      s.genre ? s.genre.split(",").map(g => g.trim()) : [],
        cast:        s.cast ? s.cast.split(",").map(c => c.trim()) : [],
        videos:      buildVideos(info),
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

// ── Stream match helpers ──────────────────────────────────────────────────────

// Returns ALL provider items that match a TMDB entry.
// Multiple results happen when the provider has duplicates like:
//   "A Origem", "A Origem [4K]", "A Origem [L]"
// which all normalize to the same key.
//
// Strategies in order: tmdb_id → pt-BR name → original name
function findAllMatches(items, tmdbId, matchNames) {
  const matched = [];
  const seenIds = new Set();

  function addIfNew(item, idField) {
    const id = item[idField];
    if (id && !seenIds.has(id)) {
      seenIds.add(id);
      matched.push(item);
    }
  }

  // 1. tmdb_id numeric match
  if (tmdbId) {
    items
      .filter(i => i.tmdb_id && String(i.tmdb_id) === String(tmdbId))
      .forEach(i => addIfNew(i, i.series_id ? "series_id" : "stream_id"));
  }

  // 2. Name match — normalize both sides
  for (const name of matchNames) {
    const normName = normalize(name);
    if (!normName) continue;
    items
      .filter(i => cleanIptvTitle(i.name || i.title || "") === normName)
      .forEach(i => addIfNew(i, i.series_id ? "series_id" : "stream_id"));
  }

  return matched;
}

// ── Stream ────────────────────────────────────────────────────────────────────

async function handleStream(event, { xtream, keyHash }) {
  const stripped = event.path.replace(/^\/.netlify\/functions\/addon\/[^/]+\/stream\//, "");
  const parts = stripped.split("/");
  const type = parts[0];
  const id   = (parts[1] || "").replace(/\.json$/, "");

  try {
    let streams = [];

    // tt{imdbId}:season:episode — Stremio series format
    const ttSeries = id.match(/^(tt\d+):(\d+):(\d+)$/);
    if (ttSeries) {
      const [, imdbId, season, episode] = ttSeries;

      const tmdb = await getSeriesByImdbId(imdbId);
      if (tmdb) {
        const matchNames = getMatchNames(tmdb, "series");
        let matches = [];

        // Fast path: tmdb_map has a known mapping from a previous name match
        const cachedSeriesId = await cache.getTmdbMapSeries(auth.ph, tmdb.id).catch(() => null);
        if (cachedSeriesId) {
          const allSeries = await xtream.getSeries();
          const item = allSeries.find(s => String(s.series_id) === String(cachedSeriesId));
          if (item) matches = [item];
        }

        // Slow path: scan full list and populate map for next time
        if (matches.length === 0) {
          const allSeries = await xtream.getSeries();
          matches = findAllMatches(allSeries, tmdb.id, matchNames);
          // Populate tmdb_map with first match (fire-and-forget)
          if (matches.length > 0) {
            cache.setTmdbMapSeries(auth.ph, tmdb.id, matches[0].series_id).catch(() => {});
          }
        }

        console.log(`[stream] series: imdb=${imdbId} names=${JSON.stringify(matchNames)} matches=${matches.length}`);

        for (const match of matches) {
          const info = await xtream.getSeriesInfo(match.series_id);
          const eps  = info?.episodes?.[String(season)] || [];

          const pattern = new RegExp(`S0?${parseInt(season)}E0?${parseInt(episode)}(?!\\d)`, "i");
          let ep = eps.find(e => pattern.test(e.title || ""));
          if (!ep) ep = eps.find(e => String(e.episode_num) === String(episode));
          if (!ep && eps.length >= parseInt(episode)) ep = eps[parseInt(episode) - 1];

          if (ep) {
            const ext = ep.container_extension || "mp4";
            streams.push({
              url:   xtream.getEpisodeStreamUrl(ep.id, ext),
              title: match.name,
            });
            console.log(`[stream] episode found: series="${match.name}" id=${ep.id} ext=${ext}`);
          }
        }

        if (streams.length === 0) {
          console.log(`[stream] episode not found: season=${season} episode=${episode}`);
        }
      }
      cache.incrStat(keyHash, "streams_series").catch(() => {});
    }

    else if (id.startsWith("tt") && type === "movie") {
      const tmdb = await getMovieByImdbId(id);
      if (tmdb) {
        const allMovies  = await xtream.getMovies();
        const matchNames = getMatchNames(tmdb, "movie");
        const matches    = findAllMatches(allMovies, tmdb.id, matchNames);
        console.log(`[stream] movie: imdb=${id} names=${JSON.stringify(matchNames)} matches=${matches.length}`);

        for (const match of matches) {
          const ext = match.container_extension || "mp4";
          streams.push({
            url:   xtream.getMovieStreamUrl(match.stream_id, ext),
            title: match.name,
          });
        }
      }
      cache.incrStat(keyHash, "streams_movie").catch(() => {});
    }

    // xtream: native IDs — direct, no lookup needed
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
          { url: xtream.getEpisodeStreamUrl(itemId, "mp4"), title: "MP4" },
          { url: xtream.getEpisodeStreamUrl(itemId, "mkv"), title: "MKV" },
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

    return json(200, { streams }, { "Cache-Control": "public, max-age=300" });
  } catch (err) {
    console.error("[stream]", err.message);
    return json(500, { error: err.message });
  }
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
    case "manifest": return handleManifest(event, auth.payload);
    case "catalog":  return handleCatalog(event, auth);
    case "meta":     return handleMeta(event, auth);
    case "stream":   return handleStream(event, auth);
    default:         return json(404, { error: `Unknown resource: ${resource}` });
  }
};
