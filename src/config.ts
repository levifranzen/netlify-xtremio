export const env = {
  tmdbApiKey: process.env.TMDB_API_KEY || "",
  xtreamUserAgent:
    (process.env.XTREAM_USER_AGENT ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36").trim(),
  redisUrl: process.env.UPSTASH_REDIS_REST_URL || "",
  redisToken: process.env.UPSTASH_REDIS_REST_TOKEN || "",
  addonName: process.env.ADDON_NAME || "Xtremio",
  addonAuthToken: process.env.ADDON_AUTH_TOKEN || "",
};
