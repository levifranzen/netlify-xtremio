/**
 * stream.js — /.netlify/functions/stream/:token/stream/:type/:id.json
 *
 * Resolves playback stream URLs for Stremio.
 * Returns an array of stream objects; Stremio picks the first playable one.
 *
 * ID formats handled:
 *   xtream:movie:{streamId}
 *   xtream:series:{seriesId}   (not used directly — Stremio uses episode ID)
 *   xtream:live:{streamId}
 *   xtream:ep:{episodeId}      (series episode)
 *   tt{imdbId}                 (IMDb — tries to match to provider stream)
 */

const { withAuth, jsonResponse } = require("../../src/lib/middleware");
const { cache } = require("../../src/lib/cache");

function parsePath(path) {
  const parts = path.split("/");
  const streamIdx = parts.indexOf("stream", parts.indexOf("stream") + 1);
  const idRaw = parts[streamIdx + 2]?.replace(".json", "");
  return {
    type: parts[streamIdx + 1],
    id: idRaw,
  };
}

exports.handler = withAuth(async (event, context, { xtream, keyHash, ph }) => {
  const { type, id } = parsePath(event.path);

  try {
    let streams = [];

    const [, itemType, itemId] = id.split(":");

    if (itemType === "movie" || type === "movie") {
      const resolvedId = itemId || id.replace("tt", "");
      const url = xtream.getMovieStreamUrl(resolvedId, "mp4");
      streams = [
        {
          url,
          title: "MP4",
          behaviorHints: { notWebReady: false },
        },
        {
          url: xtream.getMovieStreamUrl(resolvedId, "mkv"),
          title: "MKV",
        },
      ];
      await cache.incrStat(keyHash, "streams_movie").catch(() => {});
    }

    else if (itemType === "live" || type === "tv") {
      const resolvedId = itemId || id;
      const url = xtream.getLiveStreamUrl(resolvedId, "m3u8");
      streams = [
        {
          url,
          title: "HLS",
          behaviorHints: { notWebReady: false },
        },
        {
          url: xtream.getLiveStreamUrl(resolvedId, "ts"),
          title: "TS",
        },
      ];
      await cache.incrStat(keyHash, "streams_live").catch(() => {});
    }

    else if (itemType === "ep") {
      // Episode stream — episodeId is the Xtream episode stream ID
      const url = xtream.getEpisodeStreamUrl(itemId, "mkv");
      streams = [
        {
          url,
          title: "MKV",
        },
        {
          url: xtream.getEpisodeStreamUrl(itemId, "mp4"),
          title: "MP4",
          behaviorHints: { notWebReady: false },
        },
      ];
      await cache.incrStat(keyHash, "streams_series").catch(() => {});
    }

    else if (id.startsWith("tt")) {
      // IMDb ID — try to match by searching provider movie list
      const movies = await xtream.getMovies();
      // Some providers include tmdb_id or imdb fields
      const match = movies.find(m => m.tmdb_id === id || m.imdb === id || m.o_name === id);
      if (match) {
        streams = [{ url: xtream.getMovieStreamUrl(match.stream_id, "mp4"), title: "MP4" }];
      } else {
        return jsonResponse(404, { error: "Stream not found for this IMDb ID in your provider" });
      }
      await cache.incrStat(keyHash, "streams_movie").catch(() => {});
    }

    if (streams.length === 0) {
      return jsonResponse(404, { error: "No streams found for this ID" });
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
      body: JSON.stringify({ streams }),
    };

  } catch (err) {
    console.error("[stream] Error:", err.message);
    return jsonResponse(500, { error: "Failed to resolve stream", detail: err.message });
  }
});
