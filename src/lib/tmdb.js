/**
 * tmdb.js — TMDB metadata client
 *
 * Cache key is language-scoped and type-aware inside the value:
 *   tmdb:{language}:{imdbId} -> { kind: "movie"|"series", data: {...} }
 */

const { cache } = require("./cache");

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_KEY = process.env.TMDB_API_KEY;
const IMG_BASE = "https://image.tmdb.org/t/p/w500";
const DEFAULT_LANG = process.env.TMDB_LANGUAGE || "pt-BR";
const TIMEOUT_MS = 8000;

function normalizeLanguage(language) {
  const lang = String(language || DEFAULT_LANG || "pt-BR").trim();
  return /^[a-z]{2}-[A-Z]{2}$/.test(lang) ? lang : "pt-BR";
}

async function tmdbFetch(path, language = DEFAULT_LANG) {
  if (!TMDB_KEY) {
    console.warn("[tmdb] TMDB_API_KEY not set");
    return null;
  }

  const lang = normalizeLanguage(language);
  const sep = path.includes("?") ? "&" : "?";
  const url = `${TMDB_BASE}${path}${sep}api_key=${TMDB_KEY}&language=${encodeURIComponent(lang)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      console.error(`[tmdb] HTTP ${res.status} for ${path}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    console.error(`[tmdb] fetch error for ${path}:`, err.message);
    return null;
  }
}

async function getCachedByKind(imdbId, kind, language) {
  const lang = normalizeLanguage(language);
  const cached = await cache.getTmdb(imdbId, lang);
  if (!cached) return null;

  // New format.
  if (cached.kind === kind && cached.data) return cached.data;

  // Defensive reader for old raw TMDB object caches.
  if (kind === "movie" && cached.title) return cached;
  if (kind === "series" && cached.name) return cached;

  return null;
}

async function setCachedByKind(imdbId, kind, data, language) {
  const lang = normalizeLanguage(language);
  return cache.setTmdb(imdbId, { kind, data }, lang);
}

async function getMovieByImdbId(imdbId, language = DEFAULT_LANG) {
  const lang = normalizeLanguage(language);
  const cached = await getCachedByKind(imdbId, "movie", lang);
  if (cached) return cached;

  const data = await tmdbFetch(`/find/${imdbId}?external_source=imdb_id`, lang);
  const movie = data?.movie_results?.[0] || null;

  if (movie) {
    await setCachedByKind(imdbId, "movie", movie, lang);
  } else {
    console.warn(`[tmdb] no movie result for imdb=${imdbId}`);
  }
  return movie;
}

async function getSeriesByImdbId(imdbId, language = DEFAULT_LANG) {
  const lang = normalizeLanguage(language);
  const cached = await getCachedByKind(imdbId, "series", lang);
  if (cached) return cached;

  const data = await tmdbFetch(`/find/${imdbId}?external_source=imdb_id`, lang);
  const series = data?.tv_results?.[0] || null;

  if (series) {
    await setCachedByKind(imdbId, "series", series, lang);
  } else {
    console.warn(`[tmdb] no series result for imdb=${imdbId}`);
  }
  return series;
}

function getMatchNames(tmdb, type) {
  const localizedName = type === "movie" ? tmdb?.title : tmdb?.name;
  const origName = type === "movie" ? tmdb?.original_title : tmdb?.original_name;

  const names = [localizedName];
  if (origName && origName !== localizedName && /^[\x00-\x7F]+$/.test(origName)) {
    names.push(origName);
  }
  return [...new Set(names.filter(Boolean))];
}

function movieYear(tmdb) {
  return tmdb?.release_date?.split("-")?.[0] || null;
}

function seriesYear(tmdb) {
  return tmdb?.first_air_date?.split("-")?.[0] || null;
}

function movieToMeta(id, stream, tmdb) {
  return {
    id,
    type: "movie",
    name: stream?.name || tmdb?.title || "Unknown",
    poster: tmdb?.poster_path ? `${IMG_BASE}${tmdb.poster_path}` : null,
    background: tmdb?.backdrop_path ? `${IMG_BASE}${tmdb.backdrop_path}` : null,
    description: tmdb?.overview || null,
    releaseInfo: movieYear(tmdb),
    imdbRating: tmdb?.vote_average ? String(tmdb.vote_average.toFixed(1)) : null,
    genres: [],
  };
}

function seriesToMeta(id, stream, tmdb) {
  return {
    id,
    type: "series",
    name: stream?.name || tmdb?.name || "Unknown",
    poster: tmdb?.poster_path ? `${IMG_BASE}${tmdb.poster_path}` : null,
    background: tmdb?.backdrop_path ? `${IMG_BASE}${tmdb.backdrop_path}` : null,
    description: tmdb?.overview || null,
    releaseInfo: seriesYear(tmdb),
    imdbRating: tmdb?.vote_average ? String(tmdb.vote_average.toFixed(1)) : null,
    genres: [],
  };
}

module.exports = {
  getMovieByImdbId,
  getSeriesByImdbId,
  getMatchNames,
  movieToMeta,
  seriesToMeta,
  normalizeLanguage,
  movieYear,
  seriesYear,
};
