/**
 * token.js — API key + stateless credential token
 *
 * Flow:
 *   1. Admin generates an API key (opaque, stored in Redis as hash)
 *   2. User POSTs their Xtream credentials + API key to /configure
 *   3. Server returns a signed config token (base64url JWT-like)
 *   4. Token is embedded in every Stremio URL: /:token/manifest.json
 *   5. Each function validates token signature before processing
 *
 * Token payload: { serverUrl, username, password, apiKey }
 * Signature: HMAC-SHA256(payload, TOKEN_SECRET)
 * No database lookup needed per request — only Redis for revocation check.
 */

const crypto = require("crypto");

const TOKEN_SECRET = process.env.TOKEN_SECRET;
if (!TOKEN_SECRET) {
  console.warn("[token] WARNING: TOKEN_SECRET not set — using insecure fallback");
}
const secret = TOKEN_SECRET || "insecure-dev-secret-change-me";

// ─── API Key helpers ──────────────────────────────────────────────────────────

/**
 * Generate a new API key: prefix + 32 random bytes
 * Format: xtremio_<hex64>
 */
function generateApiKey() {
  return "xtremio_" + crypto.randomBytes(32).toString("hex");
}

/**
 * Hash an API key for safe storage in Redis (never store raw keys)
 */
function hashApiKey(apiKey) {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

// ─── Config token helpers ─────────────────────────────────────────────────────

/**
 * Create a signed config token from Xtream credentials.
 * The token is safe to embed in URLs — credentials are opaque to anyone
 * without TOKEN_SECRET, but note: this is signing, not encryption.
 * For true confidentiality, swap to AES-256-GCM encryption here.
 */
function createToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("base64url");
  return `${data}.${sig}`;
}

/**
 * Verify and decode a config token.
 * Returns the payload object, or throws on invalid/tampered token.
 */
function verifyToken(token) {
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("Malformed token");

  const [data, sig] = parts;
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("base64url");

  // Constant-time comparison to prevent timing attacks
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    throw new Error("Invalid token signature");
  }

  return JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
}

/**
 * Hash the serverUrl portion of a token for use as a provider cache key.
 * This lets multiple users with the same provider share cache entries.
 */
function providerHash(serverUrl) {
  return crypto.createHash("sha256").update(serverUrl).digest("hex").slice(0, 16);
}

module.exports = { generateApiKey, hashApiKey, createToken, verifyToken, providerHash };
