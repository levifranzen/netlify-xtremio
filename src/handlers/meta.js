const { json } = require("../lib/http");
const { tmdbLanguage } = require("../lib/provider-config");
const { getMovieByImdbId, getSeriesByImdbId, movieToMeta, seriesToMeta } = require("../lib/tmdb");
const { findLiveGroupById } = require("../services/live-grouping");
const { buildVideos } = require("../services/stream-builders");

async function handleMeta(event, { xtream, payload }) {
  const stripped = event.path.replace(/^\/.netlify\/functions\/addon\/[^/]+\/meta\//, "");
  const parts = stripped.split("/");
  const type = parts[0];
  const id   = decodeURIComponent((parts[1] || "").replace(/\.json$/, ""));

  try {
    // IMDb IDs — enrich via TMDB
    if (id.startsWith("tt")) {
      if (type === "movie") {
        const tmdb = await getMovieByImdbId(id, tmdbLanguage(payload));
        return json(200, { meta: movieToMeta(id, null, tmdb) });
      }
      if (type === "series") {
        const tmdb = await getSeriesByImdbId(id, tmdbLanguage(payload));
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

    if (itemType === "ai") {
      const liveStreams = await xtream.getLiveStreams();
      const group = findLiveGroupById(liveStreams, itemId);
      return json(200, { meta: {
        id,
        type: "tv",
        name: group?.name || `Live group ${itemId}`,
        poster: group?.logo || null,
        posterShape: "square",
        description: group ? group.list.map(i => i.name).join("\n") : null,
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

module.exports = { handleMeta };
