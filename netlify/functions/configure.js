/**
 * configure.js — /.netlify/functions/configure
 *
 * POST { apiKey, serverUrl, username, password, providerName, liveFormat, tmdbLanguage }
 *   → validates API key against Redis
 *   → authenticates against Xtream provider
 *   → returns signed config token + install URL for Stremio
 *
 * GET (no body) → returns 200 health check (used by configure.html to
 *   test connectivity before showing the form)
 */

const { verifyToken, hashApiKey, createToken } = require("../../src/lib/token");
const { cache } = require("../../src/lib/cache");
const { XtreamClient } = require("../../src/lib/xtream");

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
  }

  if (event.httpMethod === "GET") {
    return jsonResponse(200, { status: "ok", service: "Xtremio SaaS" });
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const { apiKey, serverUrl, username, password } = body;
  const providerName = String(body.providerName || "Xtremio").trim() || "Xtremio";
  const liveFormatRaw = String(body.liveFormat || "m3u8").trim().toLowerCase();
  const liveFormat = liveFormatRaw === "ts" ? "ts" : "m3u8";
  const tmdbLanguageRaw = String(body.tmdbLanguage || process.env.TMDB_LANGUAGE || "pt-BR").trim();
  const tmdbLanguage = /^[a-z]{2}-[A-Z]{2}$/.test(tmdbLanguageRaw) ? tmdbLanguageRaw : "pt-BR";

  if (!apiKey || !serverUrl || !username || !password) {
    return jsonResponse(400, { error: "Missing required fields: apiKey, serverUrl, username, password" });
  }

  // ── Validate API key ────────────────────────────────────────────────────────
  const keyHash = hashApiKey(apiKey);
  let keyData;
  try {
    keyData = await cache.getApiKey(keyHash);
  } catch (err) {
    console.error("[configure] Redis error:", err.message);
    return jsonResponse(503, { error: "Service temporarily unavailable" });
  }

  if (!keyData) return jsonResponse(403, { error: "Invalid API key" });
  if (keyData.revoked) return jsonResponse(403, { error: "This API key has been revoked" });

  // ── Validate Xtream credentials ─────────────────────────────────────────────
  let authResult;
  try {
    const client = new XtreamClient(serverUrl, username, password);
    authResult = await client.authenticate();
  } catch (err) {
    return jsonResponse(502, { error: "Could not connect to provider", detail: err.message });
  }

  if (!authResult?.user_info || authResult.user_info.auth === 0) {
    return jsonResponse(401, { error: "Invalid Xtream credentials" });
  }

  // ── Create signed token ─────────────────────────────────────────────────────
  const token = createToken({
    serverUrl,
    username,
    password,
    apiKey,
    providerName,
    liveFormat,
    tmdbLanguage,
  });

  // Track configuration event
  await cache.incrStat(keyHash, "configurations").catch(() => {});

  // Build Stremio install URL
  const host = `https://${event.headers.host}`;
  const manifestUrl = `${host}/.netlify/functions/addon/${token}/manifest.json`;
  const stremioUrl = `stremio://${host.replace("https://", "")}/.netlify/functions/addon/${token}/manifest.json`;

  return jsonResponse(200, {
    token,
    manifestUrl,
    stremioUrl,
    userInfo: {
      status: authResult.user_info.status,
      expirationDate: authResult.user_info.exp_date,
      maxConnections: authResult.user_info.max_connections,
      activeConnections: authResult.user_info.active_cons,
    },
  });
};
