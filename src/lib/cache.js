/**
 * cache.js — Upstash Redis via REST API (POST pipeline)
 *
 * Provider catalog (categories/live/movies/series) is NOT cached here anymore —
 * it lives only in the in-memory "hot" layer inside xtream.js. Redis is reserved
 * for the two things worth persisting across cold starts: TMDB lookups and the
 * TMDB -> provider-id match results (both expensive to recompute, both safe to
 * serve slightly stale).
 *
 * Cache key schema:
 *   match:{providerHash}:{tmdbId}           TTL 30 days  TMDB -> provider IDs
 *   tmdb:{language}:{imdbId}                TTL 30 days  TMDB /find result, language-scoped
 *   apikey:{hashedKey}                      no TTL       admin managed
 *   apikey:{hashedKey}:stats                no TTL       counters
 *   blocked:provider:{providerHash}         no TTL       admin managed
 */

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const TTL = {
  LONG: 60 * 60 * 24 * 30,    // 30 days
};

async function pipeline(...commands) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    throw new Error("Upstash Redis env vars not configured");
  }

  const res = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
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

async function cmd(...args) {
  const [result] = await pipeline(args);
  return result;
}

async function get(key) {
  const val = await cmd("GET", key);
  if (val === null || val === undefined) return null;
  try { return JSON.parse(val); } catch { return val; }
}

async function set(key, value, ttlSeconds = null) {
  const serialized = JSON.stringify(value);
  if (ttlSeconds) {
    await pipeline(["SET", key, serialized], ["EXPIRE", key, ttlSeconds]);
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

const keys = {
  providerMatch: (ph, tmdbId) => `match:${ph}:${tmdbId}`,
  tmdb: (lang, imdbId) => `tmdb:${lang}:${imdbId}`,

  apiKey: (hash) => `apikey:${hash}`,
  apiKeyStats: (hash) => `apikey:${hash}:stats`,
  blockedProvider: (ph) => `blocked:provider:${ph}`,
};

function normalizeMatchEntries(entries) {
  if (!Array.isArray(entries)) return [];

  return entries
    .map(entry => {
      if (Array.isArray(entry)) {
        const id = Number(entry[0]);
        if (!id) return null;
        return entry.length > 1 && entry[1] ? [id, String(entry[1])] : [id];
      }

      // Defensive reader for temporary object-shaped caches from prior builds.
      if (entry && typeof entry === "object") {
        const id = Number(entry.id || entry.stream_id || entry.series_id || entry.providerId);
        if (!id) return null;
        const ext = entry.ext || entry.container_extension;
        return ext ? [id, String(ext)] : [id];
      }

      const id = Number(entry);
      return id ? [id] : null;
    })
    .filter(Boolean);
}

const cache = {
  // Exposed for admin/debug helpers that need raw key reads.
  get,
  set,
  del,

  // TMDB metadata, language-scoped and type-aware inside the value.
  async getTmdb(imdbId, lang = "pt-BR") { return get(keys.tmdb(lang, imdbId)); },
  async setTmdb(imdbId, value, lang = "pt-BR") { return set(keys.tmdb(lang, imdbId), value, TTL.LONG); },

  // TMDB -> provider match.
  // Movie value: [[stream_id, ext], ...]
  // Series value: [[series_id], ...]
  async getProviderMatch(ph, tmdbId) {
    const value = await get(keys.providerMatch(ph, tmdbId));
    const entries = normalizeMatchEntries(value);
    return entries.length ? entries : null;
  },
  async setProviderMatch(ph, tmdbId, entries) {
    const normalized = normalizeMatchEntries(entries);
    if (normalized.length === 0) return null;

    const seen = new Set();
    const deduped = [];
    for (const entry of normalized) {
      const key = entry.join(":");
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(entry);
    }

    return set(keys.providerMatch(ph, tmdbId), deduped, TTL.LONG);
  },

  // API key management — no TTL.
  async getApiKey(hash) { return get(keys.apiKey(hash)); },
  async setApiKey(hash, value) { return set(keys.apiKey(hash), value); },
  async delApiKey(hash) { return del(keys.apiKey(hash)); },

  // Stats — Redis HASH is still used for counters, but no generic index helpers remain.
  async incrStat(hash, field) {
    return cmd("HINCRBY", keys.apiKeyStats(hash), field, 1);
  },
  async getStats(hash) {
    const result = await cmd("HGETALL", keys.apiKeyStats(hash));
    if (!result || result.length === 0) return {};
    const obj = {};
    for (let i = 0; i < result.length; i += 2) {
      obj[result[i]] = parseInt(result[i + 1], 10);
    }
    return obj;
  },
  async getAllApiKeyHashes() {
    const result = await cmd("KEYS", "apikey:*:stats");
    return (result || []).map(k => k.replace("apikey:", "").replace(":stats", ""));
  },

  // Provider blocklist — no TTL.
  async isProviderBlocked(ph) { return exists(keys.blockedProvider(ph)); },
  async blockProvider(ph, reason) { return set(keys.blockedProvider(ph), { reason, blockedAt: Date.now() }); },
  async unblockProvider(ph) { return del(keys.blockedProvider(ph)); },
  async getAllBlockedProviders() {
    const result = await cmd("KEYS", "blocked:provider:*");
    return (result || []).map(k => k.replace("blocked:provider:", ""));
  },
};

module.exports = { cache, TTL, keys, get, set, del, cmd, pipeline };
