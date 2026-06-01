/**
 * xtream.js — Xtream Codes API client
 *
 * All methods cache by providerHash so users sharing the same
 * serverUrl share cache entries without exposing credentials.
 */

const fetch = require("node-fetch");
const { cache } = require("./cache");
const { providerHash } = require("./token");

// ─── HTTP helper with retry ───────────────────────────────────────────────────

async function fetchWithRetry(url, retries = 3, delayMs = 500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { timeout: 20000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, delayMs * attempt));
    }
  }
}

// ─── XtreamClient class ───────────────────────────────────────────────────────

class XtreamClient {
  constructor(serverUrl, username, password) {
    // Normalise trailing slash
    this.base = serverUrl.replace(/\/$/, "");
    this.username = username;
    this.password = password;
    this.ph = providerHash(serverUrl);
  }

  _apiUrl(action, extra = "") {
    return `${this.base}/player_api.php?username=${this.username}&password=${this.password}&action=${action}${extra}`;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  async authenticate() {
    const url = `${this.base}/player_api.php?username=${this.username}&password=${this.password}`;
    return fetchWithRetry(url);
  }

  // ── Categories ───────────────────────────────────────────────────────────

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

  // ── Live TV ───────────────────────────────────────────────────────────────

  async getLiveStreams(categoryId = null) {
    const cached = await cache.getCatalogLive(this.ph);
    if (cached) return categoryId ? cached.filter(s => s.category_id == categoryId) : cached;

    const streams = await fetchWithRetry(this._apiUrl("get_live_streams"));
    await cache.setCatalogLive(this.ph, streams);
    return categoryId ? streams.filter(s => s.category_id == categoryId) : streams;
  }

  getLiveStreamUrl(streamId, ext = "m3u8") {
    return `${this.base}/live/${this.username}/${this.password}/${streamId}.${ext}`;
  }

  // ── Movies ────────────────────────────────────────────────────────────────

  async getMovies(categoryId = null) {
    const cached = await cache.getCatalogMovies(this.ph);
    const movies = cached || await fetchWithRetry(this._apiUrl("get_vod_streams"));
    if (!cached) await cache.setCatalogMovies(this.ph, movies);
    return categoryId ? movies.filter(m => m.category_id == categoryId) : movies;
  }

  async getMovieInfo(vodId) {
    return fetchWithRetry(this._apiUrl("get_vod_info", `&vod_id=${vodId}`));
  }

  getMovieStreamUrl(streamId, ext = "mp4") {
    return `${this.base}/movie/${this.username}/${this.password}/${streamId}.${ext}`;
  }

  // ── Series ────────────────────────────────────────────────────────────────

  async getSeries(categoryId = null) {
    const cached = await cache.getCatalogSeries(this.ph);
    const series = cached || await fetchWithRetry(this._apiUrl("get_series"));
    if (!cached) await cache.setCatalogSeries(this.ph, series);
    return categoryId ? series.filter(s => s.category_id == categoryId) : series;
  }

  async getSeriesInfo(seriesId) {
    const cached = await cache.getSeriesInfo(this.ph, seriesId);
    if (cached) return cached;

    // Retry up to 3x — some providers are flaky on this endpoint
    const info = await fetchWithRetry(this._apiUrl("get_series_info", `&series_id=${seriesId}`), 3, 800);
    await cache.setSeriesInfo(this.ph, seriesId, info);
    return info;
  }

  getEpisodeStreamUrl(streamId, ext = "mkv") {
    return `${this.base}/series/${this.username}/${this.password}/${streamId}.${ext}`;
  }
}

module.exports = { XtreamClient };
