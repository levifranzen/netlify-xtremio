/**
 * cache.js — Upstash Redis via REST API (POST pipeline)
 *
 * All commands use POST /pipeline with JSON body to avoid 431 errors
 * that occur when large values are encoded in the URL path.
 *
 * Cache key schema:
 *   provider:{providerHash}:categories          TTL 30 days
 *   provider:{providerHash}:catalog:movies      TTL 30 min
 *   provider:{providerHash}:catalog:series      TTL 30 min
 *   provider:{providerHash}:catalog:live        TTL 30 min
 *   provider:{providerHash}:series:{id}         TTL 30 days
 *   provider:{providerHash}:idx:movies          TTL 30 days  (HASH — field per normalized title)
 *   provider:{providerHash}:idx:series          TTL 30 days  (HASH — field per normalized title)
 *   provider:{providerHash}:idx:status          TTL 30 days
 *   tmdb:movie:{imdbId}                         TTL 30 days
 *   tmdb:series:{imdbId}                        TTL 30 days
 *   apikey:{hashedKey}                          no TTL (admin managed)
 *   apikey:{hashedKey}:stats                    no TTL (counters)
 *   blocked:provider:{providerHash}             no TTL (admin managed)
 */

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const TTL = {
  CATALOG:     60 * 30,           // 30 min  — raw catalog lists
  LONG:        60 * 60 * 24 * 30, // 30 days — everything else
};

// ─── Core: POST pipeline ──────────────────────────────────────────────────────

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

// ─── HASH helpers (for provider index) ───────────────────────────────────────

async function hset(key, field, value) {
  return cmd("HSET", key, field, JSON.stringify(value));
}

async function hget(key, field) {
  const val = await cmd("HGET", key, field);
  if (val === null || val === undefined) return null;
  try { return JSON.parse(val); } catch { return val; }
}

async function hlen(key) {
  return cmd("HLEN", key);
}

async function hdel(key, ...fields) {
  return cmd("HDEL", key, ...fields);
}

/**
 * Write a { field: value } map to a Redis HASH in batches via pipeline.
 * Sends batchSize HSET commands per pipeline call.
 */
async function hsetBatch(key, map, batchSize = 50) {
  const entries = Object.entries(map);
  if (entries.length === 0) return;

  for (let i = 0; i < entries.length; i += batchSize) {
    const slice = entries.slice(i, i + batchSize);
    const commands = slice.map(([field, value]) => [
      "HSET", key, field, JSON.stringify(value),
    ]);
    await pipeline(...commands);
  }
}

// ─── Key schema ───────────────────────────────────────────────────────────────

const keys = {
  categories:      (ph)     => `provider:${ph}:categories`,
  catalogMovies:   (ph)     => `provider:${ph}:catalog:movies`,
  catalogSeries:   (ph)     => `provider:${ph}:catalog:series`,
  catalogLive:     (ph)     => `provider:${ph}:catalog:live`,
  seriesInfo:      (ph, id) => `provider:${ph}:series:${id}`,
  idxMovies:       (ph)     => `provider:${ph}:idx:movies`,
  idxSeries:       (ph)     => `provider:${ph}:idx:series`,
  idxStatus:       (ph)     => `provider:${ph}:idx:status`,
  tmdbMovie:       (id)     => `tmdb:movie:${id}`,
  tmdbSeries:      (id)     => `tmdb:series:${id}`,
  tmdbMapMovies:   (ph)     => `provider:${ph}:tmdb_map:movies`,
  tmdbMapSeries:   (ph)     => `provider:${ph}:tmdb_map:series`,
  apiKey:          (hash)   => `apikey:${hash}`,
  apiKeyStats:     (hash)   => `apikey:${hash}:stats`,
  blockedProvider: (ph)     => `blocked:provider:${ph}`,
};

// ─── High-level cache helpers ─────────────────────────────────────────────────

const cache = {
  // Provider catalog — short TTL (data changes frequently)
  async getCategories(ph)        { return get(keys.categories(ph)); },
  async setCategories(ph, v)     { return set(keys.categories(ph), v, TTL.LONG); },
  async getCatalogMovies(ph)     { return get(keys.catalogMovies(ph)); },
  async setCatalogMovies(ph, v)  { return set(keys.catalogMovies(ph), v, TTL.CATALOG); },
  async getCatalogSeries(ph)     { return get(keys.catalogSeries(ph)); },
  async setCatalogSeries(ph, v)  { return set(keys.catalogSeries(ph), v, TTL.CATALOG); },
  async getCatalogLive(ph)       { return get(keys.catalogLive(ph)); },
  async setCatalogLive(ph, v)    { return set(keys.catalogLive(ph), v, TTL.CATALOG); },

  // Series info — long TTL
  async getSeriesInfo(ph, id)    { return get(keys.seriesInfo(ph, id)); },
  async setSeriesInfo(ph, id, v) { return set(keys.seriesInfo(ph, id), v, TTL.LONG); },

  // Provider index (HASH) — long TTL, rebuilt by load-background
  idxMoviesKey:               (ph)          => keys.idxMovies(ph),
  idxSeriesKey:               (ph)          => keys.idxSeries(ph),
  async getIdxMovie(ph, field)              { return hget(keys.idxMovies(ph), field); },
  async getIdxSeries(ph, field)             { return hget(keys.idxSeries(ph), field); },
  async lenIdxMovies(ph)                    { return hlen(keys.idxMovies(ph)); },
  async lenIdxSeries(ph)                    { return hlen(keys.idxSeries(ph)); },
  async getIdxStatus(ph)                    { return get(keys.idxStatus(ph)); },
  async setIdxStatus(ph, v)                 { return set(keys.idxStatus(ph), v, TTL.LONG); },

  // TMDB metadata — long TTL
  async getTmdbMovie(id)         { return get(keys.tmdbMovie(id)); },
  async setTmdbMovie(id, v)      { return set(keys.tmdbMovie(id), v, TTL.LONG); },
  async getTmdbSeries(id)        { return get(keys.tmdbSeries(id)); },
  async setTmdbSeries(id, v)     { return set(keys.tmdbSeries(id), v, TTL.LONG); },

  // TMDB → provider ID map — populated on successful provider match
  // Stores provider IDs as arrays, e.g. provider:{ph}:tmdb_map:series HGET 1399 -> [123,456]
  // This is the match cache that avoids rebuilding/rediscovering title matches every request.
  async getTmdbMapMovie(ph, tmdbId) {
    return hget(keys.tmdbMapMovies(ph), String(tmdbId));
  },
  async setTmdbMapMovie(ph, tmdbId, streamIds) {
    const key = keys.tmdbMapMovies(ph);
    return pipeline(
      ["HSET", key, String(tmdbId), JSON.stringify(Array.isArray(streamIds) ? streamIds : [streamIds])],
      ["EXPIRE", key, TTL.LONG],
    );
  },
  async getTmdbMapSeries(ph, tmdbId) {
    return hget(keys.tmdbMapSeries(ph), String(tmdbId));
  },
  async setTmdbMapSeries(ph, tmdbId, seriesIds) {
    const key = keys.tmdbMapSeries(ph);
    return pipeline(
      ["HSET", key, String(tmdbId), JSON.stringify(Array.isArray(seriesIds) ? seriesIds : [seriesIds])],
      ["EXPIRE", key, TTL.LONG],
    );
  },

  // API key management — no TTL (admin controlled)
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

  // Provider blocklist — no TTL (admin controlled)
  async isProviderBlocked(ph)     { return exists(keys.blockedProvider(ph)); },
  async blockProvider(ph, reason) { return set(keys.blockedProvider(ph), { reason, blockedAt: Date.now() }); },
  async unblockProvider(ph)       { return del(keys.blockedProvider(ph)); },
  async getAllBlockedProviders() {
    const result = await cmd("KEYS", "blocked:provider:*");
    return (result || []).map(k => k.replace("blocked:provider:", ""));
  },
};

module.exports = { cache, TTL, keys, get, set, del, cmd, pipeline, hset, hget, hlen, hdel, hsetBatch };
