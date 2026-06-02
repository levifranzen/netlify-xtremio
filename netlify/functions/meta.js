/**
 * meta.js — /.netlify/functions/meta/:token/meta/:type/:id.json
 *
 * Returns detailed metadata for a single item.
 * For IMDb IDs (tt*): fetches TMDB metadata + maps to Xtream stream.
 * For xtream: IDs: fetches info directly from provider.
 *
 * For series: also builds the episode list from provider data.
 */

const { withAuth, jsonResponse } = require("../../src/lib/middleware");
const { getMovieByImdbId, getSeriesByImdbId, movieToMeta, seriesToMeta } = require("../../src/lib/tmdb");

function parsePath(path) {
  const parts = path.split("/");
  const metaIdx = parts.indexOf("meta", parts.indexOf("meta") + 1);
  const idRaw = parts[metaIdx + 2]?.replace(".json", "");
  return {
    type: parts[metaIdx + 1],
    id: idRaw,
  };
}

// Build Stremio episode objects from Xtream series info
function buildVideos(seriesInfo) {
  const videos = [];
  const episodes = seriesInfo?.episodes || {};

  for (const [season, eps] of Object.entries(episodes)) {
    for (const ep of eps) {
      videos.push({
        id: `xtream:ep:${ep.id}`,
        title: ep.title || `Episode ${ep.episode_num}`,
        season: parseInt(season),
        episode: parseInt(ep.episode_num),
        released: ep.added ? new Date(parseInt(ep.added) * 1000).toISOString() : null,
        overview: ep.info?.plot || null,
        thumbnail: ep.info?.movie_image || null,
        streams: [{ url: `xtream:ep:${ep.id}` }], // resolved by stream.js
      });
    }
  }

  return videos.sort((a, b) => a.season - b.season || a.episode - b.episode);
}

exports.handler = withAuth(async (event, context, { xtream }) => {
  const { type, id } = parsePath(event.path);

  try {
    // ── IMDb ID path ────────────────────────────────────────────────────────
    if (id.startsWith("tt")) {
      if (type === "movie") {
        const tmdb = await getMovieByImdbId(id);
        const meta = movieToMeta(id, null, tmdb);
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ meta }),
        };
      }

      if (type === "series") {
        const tmdb = await getSeriesByImdbId(id);
        const meta = seriesToMeta(id, null, tmdb);
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ meta }),
        };
      }
    }

    // ── Xtream native ID path ───────────────────────────────────────────────
    // Format: xtream:movie:{streamId} | xtream:series:{seriesId} | xtream:live:{streamId}
    const [, itemType, itemId] = id.split(":");

    if (itemType === "movie") {
      const info = await xtream.getMovieInfo(itemId);
      const movie = info?.info || {};
      const meta = {
        id,
        type: "movie",
        name: movie.name || info?.movie_data?.name || "Unknown",
        poster: movie.movie_image || null,
        background: movie.backdrop_path?.[0] ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path[0]}` : null,
        description: movie.plot || null,
        releaseInfo: movie.releasedate?.split("-")[0] || null,
        imdbRating: movie.rating_5based ? String((movie.rating_5based * 2).toFixed(1)) : null,
        runtime: movie.duration || null,
        genres: movie.genre ? movie.genre.split(",").map(g => g.trim()) : [],
        cast: movie.cast ? movie.cast.split(",").map(c => c.trim()) : [],
        director: movie.director ? [movie.director] : [],
      };
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ meta }),
      };
    }

    if (itemType === "series") {
      const info = await xtream.getSeriesInfo(itemId);
      const s = info?.info || {};
      const meta = {
        id,
        type: "series",
        name: s.name || "Unknown",
        poster: s.cover || null,
        background: s.backdrop_path?.[0] ? `https://image.tmdb.org/t/p/w1280${s.backdrop_path[0]}` : null,
        description: s.plot || null,
        releaseInfo: s.releaseDate?.split("-")[0] || null,
        imdbRating: s.rating_5based ? String((s.rating_5based * 2).toFixed(1)) : null,
        genres: s.genre ? s.genre.split(",").map(g => g.trim()) : [],
        cast: s.cast ? s.cast.split(",").map(c => c.trim()) : [],
        videos: buildVideos(info),
      };
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ meta }),
      };
    }

    if (itemType === "live") {
      // Live TV has minimal meta
      const streams = await xtream.getLiveStreams();
      const stream = streams.find(s => String(s.stream_id) === String(itemId));
      const meta = {
        id,
        type: "tv",
        name: stream?.name || `Channel ${itemId}`,
        poster: stream?.stream_icon || null,
      };
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ meta }),
      };
    }

    return jsonResponse(404, { error: "Unknown ID format" });

  } catch (err) {
    console.error("[meta] Error:", err.message);
    return jsonResponse(500, { error: "Failed to fetch metadata", detail: err.message });
  }
});
