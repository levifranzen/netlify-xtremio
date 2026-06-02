/**
 * catalog.js — /.netlify/functions/catalog/:token/catalog/:type/:id.json
 *
 * Handles catalog requests from Stremio for movies, series, and live TV.
 * Results are served from provider-scoped Redis cache when available.
 *
 * Supports:
 *   - ?genre=  → filter by category name
 *   - ?search= → basic title search (client-side filter on cached data)
 *   - ?skip=   → pagination (100 items per page)
 */

const { withAuth, jsonResponse } = require("../../src/lib/middleware");
const { cache } = require("../../src/lib/cache");

const PAGE_SIZE = 100;

// Parse extra params from Stremio catalog URL
// Path format: /catalog/{type}/{id}/{extra}.json
// Extra may be: genre=Action.json or search=batman.json or just .json
function parseExtra(path) {
  const extra = {};
  const match = path.match(/\/([^/]+)\.json$/);
  if (!match) return extra;
  const segment = decodeURIComponent(match[1]);
  segment.split("&").forEach(part => {
    const [k, v] = part.split("=");
    if (k && v) extra[k] = v;
  });
  return extra;
}

function parsePath(path) {
  // /.netlify/functions/catalog/:token/catalog/:type/:id/...
  const parts = path.split("/");
  const catalogIdx = parts.indexOf("catalog", parts.indexOf("catalog") + 1); // second 'catalog'
  return {
    type: parts[catalogIdx + 1],
    id:   parts[catalogIdx + 2],
  };
}

exports.handler = withAuth(async (event, context, { xtream, ph }) => {
  const { type } = parsePath(event.path);
  const extra = parseExtra(event.path);
  const skip = parseInt(extra.skip || "0");
  const genre = extra.genre || null;
  const search = extra.search ? extra.search.toLowerCase() : null;

  try {
    let metas = [];

    if (type === "movie") {
      const movies = await xtream.getMovies();
      let filtered = movies;

      if (genre) {
        const categories = await xtream.getCategories();
        const cat = categories.movies.find(c => c.category_name === genre);
        if (cat) filtered = movies.filter(m => m.category_id == cat.category_id);
      }
      if (search) {
        filtered = filtered.filter(m => m.name?.toLowerCase().includes(search));
      }

      await cache.incrStat("global", "catalog_movies_served").catch(() => {});

      metas = filtered.slice(skip, skip + PAGE_SIZE).map(m => ({
        id: m.stream_id ? `xtream:movie:${m.stream_id}` : `tt${m.tmdb_id || m.stream_id}`,
        type: "movie",
        name: m.name,
        poster: m.stream_icon || null,
        releaseInfo: m.year ? String(m.year) : null,
      }));

    } else if (type === "series") {
      const series = await xtream.getSeries();
      let filtered = series;

      if (genre) {
        const categories = await xtream.getCategories();
        const cat = categories.series.find(c => c.category_name === genre);
        if (cat) filtered = series.filter(s => s.category_id == cat.category_id);
      }
      if (search) {
        filtered = filtered.filter(s => s.name?.toLowerCase().includes(search));
      }

      await cache.incrStat("global", "catalog_series_served").catch(() => {});

      metas = filtered.slice(skip, skip + PAGE_SIZE).map(s => ({
        id: s.series_id ? `xtream:series:${s.series_id}` : `tt${s.tmdb_id || s.series_id}`,
        type: "series",
        name: s.name,
        poster: s.cover || null,
        releaseInfo: s.releaseDate ? s.releaseDate.split("-")[0] : null,
      }));

    } else if (type === "tv") {
      const streams = await xtream.getLiveStreams();
      let filtered = streams;

      if (genre) {
        const categories = await xtream.getCategories();
        const cat = categories.live.find(c => c.category_name === genre);
        if (cat) filtered = streams.filter(s => s.category_id == cat.category_id);
      }
      if (search) {
        filtered = filtered.filter(s => s.name?.toLowerCase().includes(search));
      }

      await cache.incrStat("global", "catalog_live_served").catch(() => {});

      metas = filtered.slice(skip, skip + PAGE_SIZE).map(s => ({
        id: `xtream:live:${s.stream_id}`,
        type: "tv",
        name: s.name,
        poster: s.stream_icon || null,
      }));
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=1800",
      },
      body: JSON.stringify({ metas }),
    };

  } catch (err) {
    console.error("[catalog] Error:", err.message);
    return jsonResponse(500, { error: "Failed to fetch catalog", detail: err.message });
  }
});
