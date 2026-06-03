/**
 * cache.js — Upstash Redis via REST API (POST pipeline)
 *
 * All commands use POST /pipeline with JSON body to avoid 431 errors
 * that occur when large values are encoded in the URL path.
 *
 * Cache key schema:
 *   provider:{providerHash}:categories          TTL 30min
 *   provider:{providerHash}:catalog:movies      TTL 30min
 *   provider:{providerHash}:catalog:series      TTL 30min
 *   provider:{providerHash}:catalog:live        TTL 30min
 *   provider:{providerHash}:series:{id}         TTL 2h
 *   provider:{providerHash}:idx:movies          TTL 30min  (JSON index blob)
 *   provider:{providerHash}:idx:series          TTL 30min  (JSON index blob)
 *   provider:{providerHash}:idx:status          TTL 30min
 *   tmdb:movie:{imdbId}                         TTL 24h
 *   tmdb:series:{imdbId}                        TTL 24h
 *   apikey:{hashedKey}                          no TTL (admin managed)
 *   apikey:{hashedKey}:stats                    no TTL (counters)
 *   blocked:provider:{providerHash}             no TTL (admin managed)
 */

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// TTLs in seconds
const TTL = {
  CATEGORIES:  60 * 30,
  CATALOG:     60 * 30,
  SERIES_INFO: 60 * 60 * 2,
  TMDB:        60 * 60 * 24,
};

// ─── Core: POST pipeline ──────────────────────────────────────────────────────
// Sends one or more Redis commands as a JSON array via POST.
// Returns array of results in the same order.

async function pipeline(...commands) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    throw new Error("Upstash Redis env vars not configured");
  }
  const res = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Redis error: ${res.status} ${text}`);
  }
  const results = await res.json();
  // pipeline returns [{result: ...}, {result: ...}]
  return results.map(r => r.result);
}

// Single command shorthand
async function cmd(...args) {
  const [result] = await pipeline(args);
  return result;
}

// ─── Generic get / set / del ──────────────────────────────────────────────────

async function get(key) {
  const val = await cmd("GET", key);
  if (val === null || val === undefined) return null;
  try { return JSON.parse(val); } catch { return val; }
}

async function set(key, value, ttlSeconds = null) {
  const serialized = JSON.stringify(value);
  if (ttlSeconds) {
    await pipeline(
      ["SET", key, serialized],
      ["EXPIRE", key, ttlSeconds],
    );
  } else {
    await cmd("SET", key, serialized);
  }
}

async function del(key) {
  return cmd("DEL", key);
}

async function exists(key) {
  const result = await cmd("EXISTS", key);
  return result === 1;
}

// ─── Provider-scoped cache helpers ───────────────────────────────────────────

const keys = {
  categories:     (ph)     => `provider:${ph}:categories`,
  catalogMovies:  (ph)     => `provider:${ph}:catalog:movies`,
  catalogSeries:  (ph)     => `provider:${ph}:catalog:series`,
  catalogLive:    (ph)     => `provider:${ph}:catalog:live`,
  seriesInfo:     (ph, id) => `provider:${ph}:series:${id}`,
  idxMovies:      (ph)     => `provider:${ph}:idx:movies`,
  idxSeries:      (ph)     => `provider:${ph}:idx:series`,
  idxStatus:      (ph)     => `provider:${ph}:idx:status`,
  tmdbMovie:      (id)     => `tmdb:movie:${id}`,
  tmdbSeries:     (id)     => `tmdb:series:${id}`,
  apiKey:         (hash)   => `apikey:${hash}`,
  apiKeyStats:    (hash)   => `apikey:${hash}:stats`,
  blockedProvider:(ph)     => `blocked:provider:${ph}`,
};

const cache = {
  // Provider catalog
  async getCategories(ph)        { return get(keys.categories(ph)); },
  async setCategories(ph, v)     { return set(keys.categories(ph), v, TTL.CATEGORIES); },
  async getCatalogMovies(ph)     { return get(keys.catalogMovies(ph)); },
  async setCatalogMovies(ph, v)  { return set(keys.catalogMovies(ph), v, TTL.CATALOG); },
  async getCatalogSeries(ph)     { return get(keys.catalogSeries(ph)); },
  async setCatalogSeries(ph, v)  { return set(keys.catalogSeries(ph), v, TTL.CATALOG); },
  async getCatalogLive(ph)       { return get(keys.catalogLive(ph)); },
  async setCatalogLive(ph, v)    { return set(keys.catalogLive(ph), v, TTL.CATALOG); },
  async getSeriesInfo(ph, id)    { return get(keys.seriesInfo(ph, id)); },
  async setSeriesInfo(ph, id, v) { return set(keys.seriesInfo(ph, id), v, TTL.SERIES_INFO); },

  // Provider index (JSON blobs)
  async getIdxMovies(ph)         { return get(keys.idxMovies(ph)); },
  async setIdxMovies(ph, v)      { return set(keys.idxMovies(ph), v, TTL.CATALOG); },
  async getIdxSeries(ph)         { return get(keys.idxSeries(ph)); },
  async setIdxSeries(ph, v)      { return set(keys.idxSeries(ph), v, TTL.CATALOG); },
  async getIdxStatus(ph)         { return get(keys.idxStatus(ph)); },
  async setIdxStatus(ph, v)      { return set(keys.idxStatus(ph), v, TTL.CATALOG); },

  // TMDB metadata
  async getTmdbMovie(id)         { return get(keys.tmdbMovie(id)); },
  async setTmdbMovie(id, v)      { return set(keys.tmdbMovie(id), v, TTL.TMDB); },
  async getTmdbSeries(id)        { return get(keys.tmdbSeries(id)); },
  async setTmdbSeries(id, v)     { return set(keys.tmdbSeries(id), v, TTL.TMDB); },

  // API key management
  async getApiKey(hash)          { return get(keys.apiKey(hash)); },
  async setApiKey(hash, v)       { return set(keys.apiKey(hash), v); },
  async delApiKey(hash)          { return del(keys.apiKey(hash)); },

  // Stats — atomic increment
  async incrStat(hash, field) {
    return cmd("HINCRBY", keys.apiKeyStats(hash), field, 1);
  },
  async getStats(hash) {
    const result = await cmd("HGETALL", keys.apiKeyStats(hash));
    if (!result || result.length === 0) return {};
    const obj = {};
    for (let i = 0; i < result.length; i += 2) {
      obj[result[i]] = parseInt(result[i + 1]);
    }
    return obj;
  },
  async getAllApiKeyHashes() {
    const result = await cmd("KEYS", "apikey:*:stats");
    return (result || []).map(k => k.replace("apikey:", "").replace(":stats", ""));
  },

  // Provider blocklist
  async isProviderBlocked(ph)        { return exists(keys.blockedProvider(ph)); },
  async blockProvider(ph, reason)    { return set(keys.blockedProvider(ph), { reason, blockedAt: Date.now() }); },
  async unblockProvider(ph)          { return del(keys.blockedProvider(ph)); },
  async getAllBlockedProviders() {
    const result = await cmd("KEYS", "blocked:provider:*");
    return (result || []).map(k => k.replace("blocked:provider:", ""));
  },
};

module.exports = { cache, TTL, keys, get, set, del, cmd, pipeline };
