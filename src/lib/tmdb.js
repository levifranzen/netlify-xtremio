/**
 * tmdb.js — TMDB metadata client
 *
 * Fetches in pt-BR so translated titles (e.g. "Devoradores de Estrelas")
 * match what providers typically use in Portuguese-speaking markets.
 * Falls back to original_title/original_name for ASCII-only titles,
 * mirroring the logic in the original index.py.
 *
 * Results cached in Redis by IMDb ID (TTL 24h).
 */

const fetch = require("node-fetch");
const { cache } = require("./cache");

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_KEY  = process.env.TMDB_API_KEY;
const IMG_BASE  = "https://image.tmdb.org/t/p/w500";
const LANG      = "pt-BR";

async function tmdbFetch(path) {
  if (!TMDB_KEY) return null;
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${TMDB_BASE}${path}${sep}api_key=${TMDB_KEY}&language=${LANG}`, { timeout: 8000 });
  if (!res.ok) return null;
  return res.json();
}

// ─── Fetch by IMDb ID ─────────────────────────────────────────────────────────

async function getMovieByImdbId(imdbId) {
  const cached = await cache.getTmdbMovie(imdbId);
  if (cached) return cached;

  const data = await tmdbFetch(`/find/${imdbId}?external_source=imdb_id`);
  const movie = data?.movie_results?.[0] || null;
  if (movie) await cache.setTmdbMovie(imdbId, movie);
  return movie;
}

async function getSeriesByImdbId(imdbId) {
  const cached = await cache.getTmdbSeries(imdbId);
  if (cached) return cached;

  const data = await tmdbFetch(`/find/${imdbId}?external_source=imdb_id`);
  const series = data?.tv_results?.[0] || null;
  if (series) await cache.setTmdbSeries(imdbId, series);
  return series;
}

// ─── Extract match names from a TMDB result ──────────────────────────────────
// Returns [ptName, originalName] — both may be used for matching.
// original_name is only included if ASCII (non-ASCII originals are usually
// the same language as pt-BR and would duplicate the match attempt).

function getMatchNames(tmdb, type) {
  const ptName   = type === "movie" ? tmdb.title         : tmdb.name;
  const origName = type === "movie" ? tmdb.original_title : tmdb.original_name;

  const names = [ptName];
  if (origName && origName !== ptName && /^[\x00-\x7F]+$/.test(origName)) {
    names.push(origName);
  }
  return names.filter(Boolean);
}

// ─── Stremio meta format ──────────────────────────────────────────────────────

function movieToMeta(id, stream, tmdb) {
  return {
    id,
    type: "movie",
    name: stream?.name || tmdb?.title || "Unknown",
    poster: tmdb?.poster_path ? `${IMG_BASE}${tmdb.poster_path}` : null,
    background: tmdb?.backdrop_path ? `${IMG_BASE}${tmdb.backdrop_path}` : null,
    description: tmdb?.overview || null,
    releaseInfo: tmdb?.release_date?.split("-")[0] || null,
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
    releaseInfo: tmdb?.first_air_date?.split("-")[0] || null,
    imdbRating: tmdb?.vote_average ? String(tmdb.vote_average.toFixed(1)) : null,
    genres: [],
  };
}

module.exports = { getMovieByImdbId, getSeriesByImdbId, getMatchNames, movieToMeta, seriesToMeta };
