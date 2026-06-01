/**
 * tmdb.js — TMDB metadata client
 *
 * Enriches Xtream stream entries with poster, description, rating, etc.
 * Results cached in Redis by IMDb ID (TTL 24h) since metadata rarely changes.
 *
 * Requires env var: TMDB_API_KEY
 */

const fetch = require("node-fetch");
const { cache } = require("./cache");

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_KEY = process.env.TMDB_API_KEY;
const IMG_BASE = "https://image.tmdb.org/t/p/w500";

async function tmdbFetch(path) {
  if (!TMDB_KEY) return null;
  const res = await fetch(`${TMDB_BASE}${path}&api_key=${TMDB_KEY}`, { timeout: 8000 });
  if (!res.ok) return null;
  return res.json();
}

// ─── Search by title + year ───────────────────────────────────────────────────

async function searchMovie(title, year = null) {
  const q = encodeURIComponent(title);
  const yearParam = year ? `&year=${year}` : "";
  const data = await tmdbFetch(`/search/movie?query=${q}${yearParam}`);
  return data?.results?.[0] || null;
}

async function searchSeries(title, year = null) {
  const q = encodeURIComponent(title);
  const yearParam = year ? `&first_air_date_year=${year}` : "";
  const data = await tmdbFetch(`/search/tv?query=${q}${yearParam}`);
  return data?.results?.[0] || null;
}

// ─── Fetch by external IMDb ID ────────────────────────────────────────────────

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

// ─── Normalize to Stremio meta format ────────────────────────────────────────

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

module.exports = { searchMovie, searchSeries, getMovieByImdbId, getSeriesByImdbId, movieToMeta, seriesToMeta };
