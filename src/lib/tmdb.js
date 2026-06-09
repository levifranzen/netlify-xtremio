/**
 * tmdb.js — TMDB metadata client
 *
 * Fetches in the language configured per provider, e.g. pt-BR, en-US, es-ES.
 * Falls back to original_title/original_name for ASCII-only titles.
 *
 * Results cached in Redis by IMDb ID + language (TTL 30 days).
 * Uses native fetch (Node 18+) with AbortController timeout.
 */

const { cache } = require("./cache");

const TMDB_BASE    = "https://api.themoviedb.org/3";
const TMDB_KEY     = process.env.TMDB_API_KEY;
const IMG_BASE     = "https://image.tmdb.org/t/p/w500";
const DEFAULT_LANG = process.env.TMDB_LANGUAGE || "pt-BR";
const TIMEOUT_MS   = 8000;

function normalizeLanguage(language) {
  const lang = String(language || DEFAULT_LANG || "pt-BR").trim();
  return /^[a-z]{2}-[A-Z]{2}$/.test(lang) ? lang : "pt-BR";
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

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

// ─── Fetch by IMDb ID ─────────────────────────────────────────────────────────

async function getMovieByImdbId(imdbId, language = DEFAULT_LANG) {
  const lang = normalizeLanguage(language);
  const cached = await cache.getTmdbMovie(imdbId, lang);
  if (cached) return cached;

  const data  = await tmdbFetch(`/find/${imdbId}?external_source=imdb_id`, lang);
  const movie = data?.movie_results?.[0] || null;

  if (movie) {
    await cache.setTmdbMovie(imdbId, movie, lang);
  } else {
    console.warn(`[tmdb] no movie result for imdb=${imdbId}`);
  }
  return movie;
}

async function getSeriesByImdbId(imdbId, language = DEFAULT_LANG) {
  const lang = normalizeLanguage(language);
  const cached = await cache.getTmdbSeries(imdbId, lang);
  if (cached) return cached;

  const data   = await tmdbFetch(`/find/${imdbId}?external_source=imdb_id`, lang);
  const series = data?.tv_results?.[0] || null;

  if (series) {
    await cache.setTmdbSeries(imdbId, series, lang);
  } else {
    console.warn(`[tmdb] no series result for imdb=${imdbId}`);
  }
  return series;
}

// ─── Match name extraction ────────────────────────────────────────────────────
// Returns [localizedName, originalName] for use in provider matching.
// original_name is only included if ASCII — non-ASCII originals (Japanese,
// Korean, etc.) won't match anything in a Portuguese-language provider.

function getMatchNames(tmdb, type) {
  const localizedName = type === "movie" ? tmdb.title          : tmdb.name;
  const origName      = type === "movie" ? tmdb.original_title : tmdb.original_name;

  const names = [localizedName];
  if (origName && origName !== localizedName && /^[\x00-\x7F]+$/.test(origName)) {
    names.push(origName);
  }
  return names.filter(Boolean);
}

// ─── Stremio meta format ──────────────────────────────────────────────────────
// genre_ids from /find are numeric IDs, not names — resolving them
// would require an extra TMDB call. Left as [] intentionally for now.

function movieToMeta(id, stream, tmdb) {
  return {
    id,
    type:        "movie",
    name:        stream?.name || tmdb?.title || "Unknown",
    poster:      tmdb?.poster_path    ? `${IMG_BASE}${tmdb.poster_path}`    : null,
    background:  tmdb?.backdrop_path  ? `${IMG_BASE}${tmdb.backdrop_path}`  : null,
    description: tmdb?.overview       || null,
    releaseInfo: tmdb?.release_date?.split("-")[0]  || null,
    imdbRating:  tmdb?.vote_average   ? String(tmdb.vote_average.toFixed(1)) : null,
    genres:      [],
  };
}

function seriesToMeta(id, stream, tmdb) {
  return {
    id,
    type:        "series",
    name:        stream?.name || tmdb?.name || "Unknown",
    poster:      tmdb?.poster_path    ? `${IMG_BASE}${tmdb.poster_path}`    : null,
    background:  tmdb?.backdrop_path  ? `${IMG_BASE}${tmdb.backdrop_path}`  : null,
    description: tmdb?.overview       || null,
    releaseInfo: tmdb?.first_air_date?.split("-")[0] || null,
    imdbRating:  tmdb?.vote_average   ? String(tmdb.vote_average.toFixed(1)) : null,
    genres:      [],
  };
}

module.exports = { getMovieByImdbId, getSeriesByImdbId, getMatchNames, movieToMeta, seriesToMeta, normalizeLanguage };
