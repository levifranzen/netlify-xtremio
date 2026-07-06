/**
 * addon.js — /.netlify/functions/addon/:token/{manifest,catalog,meta,stream}/...
 *
 * Thin Netlify Function entrypoint for Stremio resources.
 * Route-specific logic lives in src/handlers and src/services.
 */

const { json } = require("../../src/lib/http");
const { parsePath } = require("../../src/lib/route");
const { authenticate } = require("../../src/lib/auth");
const { handleManifest } = require("../../src/handlers/manifest");
const { handleCatalog } = require("../../src/handlers/catalog");
const { handleMeta } = require("../../src/handlers/meta");
const { handleStream } = require("../../src/handlers/stream");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*" }, body: "" };
  }

  const { token, resource } = parsePath(event.path);
  if (!token) return json(400, { error: "Missing token" });

  const auth = await authenticate(token);
  if (!auth) return json(401, { error: "Invalid token or revoked key" });

  switch (resource) {
    case "manifest": return handleManifest(event, auth);
    case "catalog":  return handleCatalog(event, auth);
    case "meta":     return handleMeta(event, auth);
    case "stream":   return handleStream(event, auth);
    default:          return json(404, { error: `Unknown resource: ${resource}` });
  }
};
