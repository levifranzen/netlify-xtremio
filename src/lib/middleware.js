/**
 * middleware.js — shared logic for all Netlify Functions
 *
 * Usage in any function:
 *   const { withAuth } = require("../../src/lib/middleware");
 *   exports.handler = withAuth(async (event, context, payload) => { ... });
 *
 * withAuth:
 *   1. Extracts :token from the URL path
 *   2. Verifies HMAC signature
 *   3. Checks API key is not revoked (Redis lookup)
 *   4. Checks provider is not blocked
 *   5. Increments request counter for the API key
 *   6. Injects { payload, xtream } into the handler
 */

const { verifyToken, hashApiKey, providerHash } = require("./token");
const { cache } = require("./cache");
const { XtreamClient } = require("./xtream");

// Extract :token segment from paths like /:token/manifest.json
// Token format is base64url.base64url (contains dots) so we match
// everything between the first and second path segments greedily.
function extractToken(path) {
  // Strip function prefix if present: /.netlify/functions/manifest/TOKEN/...
  const clean = path.replace(/^\/.netlify\/functions\/[^/]+/, "");
  // clean is now /TOKEN/manifest.json or /TOKEN/catalog/...
  const match = clean.match(/^\/([^/]+)\//);
  return match ? match[1] : null;
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body),
  };
}

function withAuth(handler) {
  return async (event, context) => {
    // CORS preflight
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 204,
        headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" },
        body: "",
      };
    }

    // 1. Extract token from URL
    const rawToken = extractToken(event.path);
    if (!rawToken) return jsonResponse(400, { error: "Missing token in URL" });

    // 2. Verify signature
    let payload;
    try {
      payload = verifyToken(rawToken);
    } catch (err) {
      // DEBUG — remove after fix
      console.error("[auth] verify failed:", err.message);
      console.error("[auth] TOKEN_SECRET set:", !!process.env.TOKEN_SECRET, "length:", process.env.TOKEN_SECRET?.length ?? 0);
      console.error("[auth] token prefix:", rawToken?.slice(0, 40));
      return jsonResponse(401, { error: "Invalid or tampered token" });
    }

    const { serverUrl, username, password, apiKey } = payload;

    // 3. Check API key revocation
    const keyHash = hashApiKey(apiKey);
    const keyData = await cache.getApiKey(keyHash).catch(() => null);
    if (!keyData || keyData.revoked) {
      return jsonResponse(403, { error: "API key revoked or not found" });
    }

    // 4. Check provider blocklist
    const ph = providerHash(serverUrl);
    const blocked = await cache.isProviderBlocked(ph).catch(() => false);
    if (blocked) {
      return jsonResponse(403, { error: "This provider has been blocked by the administrator" });
    }

    // 5. Track usage (fire-and-forget — don't fail request if Redis is slow)
    cache.incrStat(keyHash, "requests").catch(() => {});

    // 6. Build Xtream client and call handler
    const xtream = new XtreamClient(serverUrl, username, password);
    return handler(event, context, { payload, xtream, keyHash, ph });
  };
}

// Admin-only middleware — validates ADMIN_SECRET header
function withAdmin(handler) {
  return async (event, context) => {
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 204,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: "",
      };
    }

    const secret = event.headers["x-admin-secret"];
    if (!secret || secret !== process.env.ADMIN_SECRET) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    return handler(event, context);
  };
}

module.exports = { withAuth, withAdmin, jsonResponse, extractToken };
