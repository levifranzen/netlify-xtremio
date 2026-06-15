const { verifyToken, hashApiKey, providerHash } = require("./token");
const { cache } = require("./cache");
const { XtreamClient } = require("./xtream");

async function authenticate(rawToken) {
  let payload;
  try { payload = verifyToken(rawToken); } catch { return null; }

  const { apiKey, serverUrl } = payload;
  const keyHash = hashApiKey(apiKey);
  const ph = providerHash(serverUrl);

  const [keyData, blocked] = await Promise.all([
    cache.getApiKey(keyHash).catch(() => null),
    cache.isProviderBlocked(ph).catch(() => false),
  ]);

  if (!keyData || keyData.revoked || blocked) return null;
  cache.incrStat(keyHash, "requests").catch(() => {});

  return { payload, keyHash, ph, xtream: new XtreamClient(payload.serverUrl, payload.username, payload.password) };
}

module.exports = { authenticate };
