/**
 * admin.js — /.netlify/functions/admin
 *
 * All routes require header: x-admin-secret: <ADMIN_SECRET>
 *
 * POST   /admin?action=create-key          → generate + store new API key
 * POST   /admin?action=revoke-key          body: { keyHash }
 * GET    /admin?action=list-keys           → all API keys + stats
 * GET    /admin?action=stats&hash={hash}   → stats for one key
 * POST   /admin?action=block-provider      body: { providerHash, reason }
 * POST   /admin?action=unblock-provider    body: { providerHash }
 * GET    /admin?action=list-blocked        → all blocked providers
 */

const { generateApiKey, hashApiKey } = require("../../src/lib/token");
const { cache } = require("../../src/lib/cache");

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, x-admin-secret",
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-admin-secret",
      },
      body: "",
    };
  }

  // Auth check
  const secret = event.headers["x-admin-secret"];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return json(401, { error: "Unauthorized" });
  }

  const action = event.queryStringParameters?.action;
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch {}

  // ── create-key ─────────────────────────────────────────────────────────────
  if (action === "create-key" && event.httpMethod === "POST") {
    const apiKey = generateApiKey();
    const keyHash = hashApiKey(apiKey);
    const keyData = {
      label: body.label || "Unnamed",
      createdAt: Date.now(),
      revoked: false,
    };
    await cache.setApiKey(keyHash, keyData);

    return json(201, {
      apiKey,        // shown ONCE — admin must copy this
      keyHash,
      label: keyData.label,
      createdAt: keyData.createdAt,
      warning: "Save this API key — it will not be shown again.",
    });
  }

  // ── revoke-key ─────────────────────────────────────────────────────────────
  if (action === "revoke-key" && event.httpMethod === "POST") {
    const { keyHash } = body;
    if (!keyHash) return json(400, { error: "Missing keyHash" });

    const keyData = await cache.getApiKey(keyHash);
    if (!keyData) return json(404, { error: "Key not found" });

    await cache.setApiKey(keyHash, { ...keyData, revoked: true, revokedAt: Date.now() });
    return json(200, { success: true, keyHash });
  }

  // ── list-keys ──────────────────────────────────────────────────────────────
  if (action === "list-keys" && event.httpMethod === "GET") {
    const hashes = await cache.getAllApiKeyHashes();

    const keys = await Promise.all(
      hashes.map(async (hash) => {
        const data = await cache.getApiKey(hash).catch(() => null);
        const stats = await cache.getStats(hash).catch(() => ({}));
        return { keyHash: hash, ...data, stats };
      })
    );

    return json(200, { keys: keys.filter(Boolean) });
  }

  // ── stats (single key) ─────────────────────────────────────────────────────
  if (action === "stats" && event.httpMethod === "GET") {
    const hash = event.queryStringParameters?.hash;
    if (!hash) return json(400, { error: "Missing hash param" });

    const data = await cache.getApiKey(hash);
    const stats = await cache.getStats(hash);
    return json(200, { keyHash: hash, ...data, stats });
  }

  // ── block-provider ─────────────────────────────────────────────────────────
  if (action === "block-provider" && event.httpMethod === "POST") {
    const { providerHash, reason } = body;
    if (!providerHash) return json(400, { error: "Missing providerHash" });

    await cache.blockProvider(providerHash, reason || "Blocked by admin");
    return json(200, { success: true, providerHash });
  }

  // ── unblock-provider ───────────────────────────────────────────────────────
  if (action === "unblock-provider" && event.httpMethod === "POST") {
    const { providerHash } = body;
    if (!providerHash) return json(400, { error: "Missing providerHash" });

    await cache.unblockProvider(providerHash);
    return json(200, { success: true, providerHash });
  }

  // ── list-blocked ───────────────────────────────────────────────────────────
  if (action === "list-blocked" && event.httpMethod === "GET") {
    const hashes = await cache.getAllBlockedProviders();
    const providers = await Promise.all(
      hashes.map(async (ph) => {
        const data = await cache.get(`blocked:provider:${ph}`).catch(() => null);
        return { providerHash: ph, ...data };
      })
    );
    return json(200, { blocked: providers.filter(Boolean) });
  }

  return json(404, { error: `Unknown action: ${action}` });
};
