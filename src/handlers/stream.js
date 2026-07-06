const { json } = require("../lib/http");
const { cache } = require("../lib/cache");
const { providerDisplayName, liveFormat, tmdbLanguage } = require("../lib/provider-config");
const { getMovieByImdbId, getSeriesByImdbId, getMatchNames, movieYear, seriesYear } = require("../lib/tmdb");
const { findAllMatches, movieMatchEntriesFromMatches, seriesMatchEntriesFromMatches } = require("../services/provider-match");
const { movieStreamsFromEntries, seriesStreamsFromEntries } = require("../services/stream-builders");

async function resolveSeriesEntries({ ph, xtream, tmdb }) {
  const cachedEntries = await cache.getProviderMatch(ph, tmdb.id).catch((err) => {
    console.error("[stream] match get error", err?.message || err);
    return null;
  });

  if (cachedEntries?.length) {
    return { entries: cachedEntries, source: "match_cache" };
  }

  const allSeries = await xtream.getSeries();
  const matchNames = getMatchNames(tmdb, "series");
  const matches = findAllMatches(allSeries, tmdb.id, matchNames, seriesYear(tmdb));
  const entries = seriesMatchEntriesFromMatches(matches);

  if (entries.length) {
    cache.setProviderMatch(ph, tmdb.id, entries).catch((err) => {
      console.error("[stream] match set error", err?.message || err);
    });
  }

  return { entries, source: "catalog" };
}

async function resolveMovieEntries({ ph, xtream, tmdb }) {
  const cachedEntries = await cache.getProviderMatch(ph, tmdb.id).catch((err) => {
    console.error("[stream] match get error", err?.message || err);
    return null;
  });

  if (cachedEntries?.length) {
    return { entries: cachedEntries, source: "match_cache" };
  }

  const allMovies = await xtream.getMovies();
  const matchNames = getMatchNames(tmdb, "movie");
  const matches = findAllMatches(allMovies, tmdb.id, matchNames, movieYear(tmdb));
  const entries = movieMatchEntriesFromMatches(matches);

  if (entries.length) {
    cache.setProviderMatch(ph, tmdb.id, entries).catch((err) => {
      console.error("[stream] match set error", err?.message || err);
    });
  }

  return { entries, source: "catalog" };
}

async function handleImdbSeriesStream({ id, xtream, keyHash, ph, providerName, selectedTmdbLanguage }) {
  const ttSeries = id.match(/^(tt\d+):(\d+):(\d+)$/);
  if (!ttSeries) return null;

  const [, imdbId, season, episode] = ttSeries;
  const tmdb = await getSeriesByImdbId(imdbId, selectedTmdbLanguage);
  let streams = [];

  if (tmdb) {
    const { entries, source } = await resolveSeriesEntries({ ph, xtream, tmdb });
    console.log(`[stream] series: imdb=${imdbId} tmdb=${tmdb.id} source=${source} matches=${entries?.length || 0}`);

    streams = await seriesStreamsFromEntries(entries || [], { xtream, providerName, tmdb, season, episode });

    if (streams.length === 0) {
      console.log(`[stream] episode not found: season=${season} episode=${episode}`);
    }
  }

  cache.incrStat(keyHash, "streams_series").catch(() => {});
  return streams;
}

async function handleImdbMovieStream({ id, xtream, keyHash, ph, providerName, selectedTmdbLanguage }) {
  const tmdb = await getMovieByImdbId(id, selectedTmdbLanguage);
  let streams = [];

  if (tmdb) {
    const { entries, source } = await resolveMovieEntries({ ph, xtream, tmdb });
    console.log(`[stream] movie: imdb=${id} tmdb=${tmdb.id} source=${source} matches=${entries?.length || 0}`);
    streams = movieStreamsFromEntries(entries || [], { xtream, providerName, tmdb });
  }

  cache.incrStat(keyHash, "streams_movie").catch(() => {});
  return streams;
}

async function handleXtreamStream({ id, xtream, keyHash, providerName, selectedLiveFormat }) {
  const [, itemType, itemId] = id.split(":");

  if (itemType === "live") {
    cache.incrStat(keyHash, "streams_live").catch(() => {});
    return [
      { name: `${providerName} | ${selectedLiveFormat.toUpperCase()}`, url: xtream.getLiveStreamUrl(itemId, selectedLiveFormat) },
    ];
  }

  return [];
}

async function handleStream(event, { xtream, keyHash, ph, payload }) {
  const stripped = event.path.replace(/^\/.netlify\/functions\/addon\/[^/]+\/stream\//, "");
  const parts = stripped.split("/");
  const type = parts[0];
  const id = decodeURIComponent((parts[1] || "").replace(/\.json$/, ""));
  const providerName = providerDisplayName(payload);
  const selectedLiveFormat = liveFormat(payload);
  const selectedTmdbLanguage = tmdbLanguage(payload);

  try {
    let streams = [];

    const seriesStreams = await handleImdbSeriesStream({ id, xtream, keyHash, ph, providerName, selectedTmdbLanguage });
    if (seriesStreams) {
      streams = seriesStreams;
    } else if (id.startsWith("tt") && type === "movie") {
      streams = await handleImdbMovieStream({ id, xtream, keyHash, ph, providerName, selectedTmdbLanguage });
    } else {
      streams = await handleXtreamStream({ id, xtream, keyHash, providerName, selectedLiveFormat });
    }

    return json(200, { streams }, { "Cache-Control": "public, max-age=300" });
  } catch (err) {
    console.error("[stream]", err?.stack || err?.message || err);
    return json(200, { streams: [] }, { "Cache-Control": "no-store" });
  }
}

module.exports = { handleStream };
