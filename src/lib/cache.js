/**
 * cache.js — Upstash Redis via REST API
 *
 * Uses Upstash's HTTP REST API (no persistent TCP connection needed,
 * perfect for serverless). Set these env vars in Netlify:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *
 * Cache key schema:
 *   provider:{providerHash}:categories          TTL 30min
 *   provider:{providerHash}:catalog:movies      TTL 30min
 *   provider:{providerHash}:catalog:series      TTL 30min
 *   provider:{providerHash}:catalog:live        TTL 30min
 *   provider:{providerHash}:series:{id}         TTL 2h
 *   tmdb:movie:{imdbId}                         TTL 24h
 *   tmdb:series:{imdbId}                        TTL 24h
 *   apikey:{hashedKey}                          no TTL (admin managed)
 *   apikey:{hashedKey}:stats                    no TTL (counters)
 *   blocked:provider:{providerHash}             no TTL (admin managed)
 */

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// TTLs in seconds
const TTL = {
  CATEGORIES: 60 * 30,        // 30 min
  CATALOG: 60 * 30,           // 30 min
  SERIES_INFO: 60 * 60 * 2,   // 2 h
  TMDB: 60 * 60 * 24,         // 24 h
};

// ─── Raw Redis commands ───────────────────────────────────────────────────────

async function redisCommand(...args) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    throw new Error("Upstash Redis env vars not configured");
  }
  const res = await fetch(`${UPSTASH_URL}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Redis error: ${res.status} ${await res.text()}`);
  const { result } = await res.json();
  return result;
}

// ─── Generic get/set/del ─────────────────────────────────────────────────────

async function get(key) {
  const val = await redisCommand("GET", key);
  if (val === null) return null;
  try { return JSON.parse(val); } catch { return val; }
}

async function set(key, value, ttlSeconds = null) {
  const serialized = JSON.stringify(value);
  if (ttlSeconds) {
    return redisCommand("SET", key, serialized, "EX", String(ttlSeconds));
  }
  return redisCommand("SET", key, serialized);
}

async function del(key) {
  return redisCommand("DEL", key);
}

async function exists(key) {
  const result = await redisCommand("EXISTS", key);
  return result === 1;
}

// ─── Provider-scoped cache helpers ───────────────────────────────────────────

const keys = {
  categories:   (ph) => `provider:${ph}:categories`,
  catalogMovies:(ph) => `provider:${ph}:catalog:movies`,
  catalogSeries:(ph) => `provider:${ph}:catalog:series`,
  catalogLive:  (ph) => `provider:${ph}:catalog:live`,
  seriesInfo:   (ph, id) => `provider:${ph}:series:${id}`,
  tmdbMovie:    (imdbId) => `tmdb:movie:${imdbId}`,
  tmdbSeries:   (imdbId) => `tmdb:series:${imdbId}`,
  apiKey:       (hash) => `apikey:${hash}`,
  apiKeyStats:  (hash) => `apikey:${hash}:stats`,
  blockedProvider:(ph) => `blocked:provider:${ph}`,
};

// Convenience wrappers with built-in TTLs
const cache = {
  // Provider catalog
  async getCategories(ph)       { return get(keys.categories(ph)); },
  async setCategories(ph, v)    { return set(keys.categories(ph), v, TTL.CATEGORIES); },
  async getCatalogMovies(ph)    { return get(keys.catalogMovies(ph)); },
  async setCatalogMovies(ph, v) { return set(keys.catalogMovies(ph), v, TTL.CATALOG); },
  async getCatalogSeries(ph)    { return get(keys.catalogSeries(ph)); },
  async setCatalogSeries(ph, v) { return set(keys.catalogSeries(ph), v, TTL.CATALOG); },
  async getCatalogLive(ph)      { return get(keys.catalogLive(ph)); },
  async setCatalogLive(ph, v)   { return set(keys.catalogLive(ph), v, TTL.CATALOG); },
  async getSeriesInfo(ph, id)   { return get(keys.seriesInfo(ph, id)); },
  async setSeriesInfo(ph, id, v){ return set(keys.seriesInfo(ph, id), v, TTL.SERIES_INFO); },

  // TMDB metadata
  async getTmdbMovie(imdbId)    { return get(keys.tmdbMovie(imdbId)); },
  async setTmdbMovie(imdbId, v) { return set(keys.tmdbMovie(imdbId), v, TTL.TMDB); },
  async getTmdbSeries(imdbId)   { return get(keys.tmdbSeries(imdbId)); },
  async setTmdbSeries(imdbId, v){ return set(keys.tmdbSeries(imdbId), v, TTL.TMDB); },

  // API key management
  async getApiKey(hash)         { return get(keys.apiKey(hash)); },
  async setApiKey(hash, v)      { return set(keys.apiKey(hash), v); },
  async delApiKey(hash)         { return del(keys.apiKey(hash)); },

  // Usage stats — atomic increments
  async incrStat(hash, field) {
    return redisCommand("HINCRBY", keys.apiKeyStats(hash), field, "1");
  },
  async getStats(hash) {
    const result = await redisCommand("HGETALL", keys.apiKeyStats(hash));
    // HGETALL returns flat [k,v,k,v,...] array from Upstash
    if (!result || result.length === 0) return {};
    const obj = {};
    for (let i = 0; i < result.length; i += 2) obj[result[i]] = parseInt(result[i+1]);
    return obj;
  },
  async getAllApiKeyHashes() {
    // Scan for all apikey:* entries (admin panel)
    const result = await redisCommand("KEYS", "apikey:*:stats");
    return (result || []).map(k => k.replace("apikey:", "").replace(":stats", ""));
  },

  // Provider blocklist
  async isProviderBlocked(ph)   { return exists(keys.blockedProvider(ph)); },
  async blockProvider(ph, reason) {
    return set(keys.blockedProvider(ph), { reason, blockedAt: Date.now() });
  },
  async unblockProvider(ph)     { return del(keys.blockedProvider(ph)); },
  async getAllBlockedProviders() {
    const result = await redisCommand("KEYS", "blocked:provider:*");
    return (result || []).map(k => k.replace("blocked:provider:", ""));
  },
};

module.exports = { cache, TTL, keys, get, set, del };
