/**
 * xtream.js — Xtream Codes API client
 *
 * Provider catalogs are cached in compact tuple form to keep Redis payloads small,
 * while public methods return readable objects for handlers.
 */

const { cache } = require("./cache");
const { providerHash } = require("./token");
const { cleanIptvTitle } = require("./normalize");

const FETCH_TIMEOUT_MS = 20000;

const PROVIDER_HEADERS = {
  "User-Agent": process.env.PROVIDER_USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  "Accept": "application/json,text/plain,*/*",
};

async function fetchWithRetry(url, retries = 3, delayMs = 500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: PROVIDER_HEADERS,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, delayMs * attempt));
    }
  }
}

function yearFrom(value) {
  if (!value) return null;
  const match = String(value).match(/(19|20)\d{2}/);
  return match ? match[0] : null;
}

function movieToTuple(movie) {
  const name = String(movie.name || "").trim();
  return [
    Number(movie.stream_id),
    cleanIptvTitle(name),
    name,
    yearFrom(movie.year),
    String(movie.container_extension || "mp4").toLowerCase(),
    movie.category_id ?? null,
    movie.stream_icon || null,
    movie.tmdb_id || null,
  ];
}

function movieFromTuple(tuple) {
  if (!Array.isArray(tuple)) {
    // Defensive hydration for old object-shaped caches.
    const name = String(tuple?.name || "").trim();
    return {
      stream_id: tuple?.stream_id,
      norm_name: tuple?.norm_name || cleanIptvTitle(name),
      name,
      year: yearFrom(tuple?.year),
      container_extension: String(tuple?.container_extension || "mp4").toLowerCase(),
      category_id: tuple?.category_id ?? null,
      tmdb_id: tuple?.tmdb_id || null,
      stream_icon: tuple?.stream_icon || null,
    };
  }

  return {
    stream_id: tuple[0],
    norm_name: tuple[1] || cleanIptvTitle(tuple[2] || ""),
    name: tuple[2] || "Unknown",
    year: tuple[3] || null,
    container_extension: tuple[4] || "mp4",
    category_id: tuple[5] ?? null,
    stream_icon: tuple[6] || null,
    tmdb_id: tuple[7] || null,
  };
}

function seriesToTuple(series) {
  const name = String(series.name || "").trim();
  return [
    Number(series.series_id),
    cleanIptvTitle(name),
    name,
    yearFrom(series.releaseDate || series.release_date),
    series.category_id ?? null,
    series.cover || null,
    series.tmdb_id || null,
  ];
}

function seriesFromTuple(tuple) {
  if (!Array.isArray(tuple)) {
    const name = String(tuple?.name || "").trim();
    return {
      series_id: tuple?.series_id,
      norm_name: tuple?.norm_name || cleanIptvTitle(name),
      name,
      releaseDate: tuple?.releaseDate || tuple?.release_date || null,
      year: yearFrom(tuple?.releaseDate || tuple?.release_date),
      category_id: tuple?.category_id ?? null,
      tmdb_id: tuple?.tmdb_id || null,
      cover: tuple?.cover || null,
    };
  }

  return {
    series_id: tuple[0],
    norm_name: tuple[1] || cleanIptvTitle(tuple[2] || ""),
    name: tuple[2] || "Unknown",
    year: tuple[3] || null,
    releaseDate: tuple[3] || null,
    category_id: tuple[4] ?? null,
    cover: tuple[5] || null,
    tmdb_id: tuple[6] || null,
  };
}

function liveToTuple(stream) {
  const name = String(stream.name || "").trim();
  return [
    Number(stream.stream_id),
    cleanIptvTitle(name),
    name,
    stream.stream_icon || null,
    stream.category_id ?? null,
  ];
}

function liveFromTuple(tuple) {
  if (!Array.isArray(tuple)) {
    const name = String(tuple?.name || "").trim();
    return {
      stream_id: tuple?.stream_id,
      norm_name: tuple?.norm_name || cleanIptvTitle(name),
      name,
      stream_icon: tuple?.stream_icon || null,
      category_id: tuple?.category_id ?? null,
    };
  }

  return {
    stream_id: tuple[0],
    norm_name: tuple[1] || cleanIptvTitle(tuple[2] || ""),
    name: tuple[2] || "Unknown",
    stream_icon: tuple[3] || null,
    category_id: tuple[4] ?? null,
  };
}

function filterByCategory(items, categoryId) {
  return categoryId ? items.filter(item => item.category_id == categoryId) : items;
}

class XtreamClient {
  constructor(serverUrl, username, password) {
    this.base = serverUrl.replace(/\/$/, "");
    this.username = username;
    this.password = password;
    this.ph = providerHash(serverUrl);
  }

  _apiUrl(action, extra = "") {
    return `${this.base}/player_api.php?username=${this.username}&password=${this.password}&action=${action}${extra}`;
  }

  async authenticate() {
    const url = `${this.base}/player_api.php?username=${this.username}&password=${this.password}`;
    return fetchWithRetry(url);
  }

  async getCategories() {
    const cached = await cache.getCategories(this.ph);
    if (cached) return cached;

    const [live, movies, series] = await Promise.all([
      fetchWithRetry(this._apiUrl("get_live_categories")),
      fetchWithRetry(this._apiUrl("get_vod_categories")),
      fetchWithRetry(this._apiUrl("get_series_categories")),
    ]);

    const result = { live, movies, series };
    await cache.setCategories(this.ph, result);
    return result;
  }

  async getLiveStreams(categoryId = null) {
    const cached = await cache.getCatalogLive(this.ph);
    if (cached) return filterByCategory(cached.map(liveFromTuple), categoryId);

    const raw = await fetchWithRetry(this._apiUrl("get_live_streams"));
    const tuples = (raw || []).map(liveToTuple).filter(row => row[0]);
    await cache.setCatalogLive(this.ph, tuples);
    return filterByCategory(tuples.map(liveFromTuple), categoryId);
  }

  getLiveStreamUrl(streamId, ext = "m3u8") {
    return `${this.base}/live/${this.username}/${this.password}/${streamId}.${ext}`;
  }

  async getMovies(categoryId = null) {
    const cached = await cache.getCatalogMovies(this.ph);
    if (cached) return filterByCategory(cached.map(movieFromTuple), categoryId);

    const raw = await fetchWithRetry(this._apiUrl("get_vod_streams"));
    const tuples = (raw || []).map(movieToTuple).filter(row => row[0]);
    await cache.setCatalogMovies(this.ph, tuples);
    return filterByCategory(tuples.map(movieFromTuple), categoryId);
  }

  async getMovieInfo(vodId) {
    const cached = await cache.getSeriesInfo(this.ph, `movie:${vodId}`);
    if (cached) return cached;

    const info = await fetchWithRetry(this._apiUrl("get_vod_info", `&vod_id=${vodId}`));
    await cache.setSeriesInfo(this.ph, `movie:${vodId}`, info);
    return info;
  }

  getMovieStreamUrl(streamId, ext = "mp4") {
    return `${this.base}/movie/${this.username}/${this.password}/${streamId}.${ext}`;
  }

  async getSeries(categoryId = null) {
    const cached = await cache.getCatalogSeries(this.ph);
    if (cached) return filterByCategory(cached.map(seriesFromTuple), categoryId);

    const raw = await fetchWithRetry(this._apiUrl("get_series"));
    const tuples = (raw || []).map(seriesToTuple).filter(row => row[0]);
    await cache.setCatalogSeries(this.ph, tuples);
    return filterByCategory(tuples.map(seriesFromTuple), categoryId);
  }

  async getSeriesInfo(seriesId) {
    const cached = await cache.getSeriesInfo(this.ph, seriesId);
    if (cached) return cached;

    const info = await fetchWithRetry(this._apiUrl("get_series_info", `&series_id=${seriesId}`), 3, 800);
    await cache.setSeriesInfo(this.ph, seriesId, info);
    return info;
  }

  getEpisodeStreamUrl(streamId, ext = "mkv") {
    return `${this.base}/series/${this.username}/${this.password}/${streamId}.${ext}`;
  }
}

module.exports = { XtreamClient };
