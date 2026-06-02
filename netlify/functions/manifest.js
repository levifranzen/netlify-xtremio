/**
* manifest.js — /.netlify/functions/manifest/:token/manifest.json
*/

const { withAuth, extractToken } = require("../../src/lib/middleware");

exports.handler = withAuth(async (event, context, { payload }) => {
  const { serverUrl } = payload;

  const host = `https://${event.headers.host}`;
  const token = extractToken(event.path);

  // Base URL for all addon resources — Stremio appends /catalog, /meta, /stream
  // We point directly to the Netlify functions via the redirect rules in netlify.toml
  const addonBase = `${host}/${token}`;

  const manifest = {
    id: `com.xtremio.saas.${Buffer.from(serverUrl).toString("base64url").slice(0, 12)}`,
    version: "1.0.0",
    name: "Xtremio",
    description: "Your IPTV provider via Xtream Codes, powered by Xtremio SaaS",
    logo: `${host}/logo.png`,

    // transportUrl tells Stremio exactly where to call catalog/meta/stream
    transportUrl: `${addonBase}/manifest.json`,
    transportName: "HTTP",

    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["tt", "xtream:"],
    catalogs: [
      {
        type: "movie",
        id: "xtremio_movies",
        name: "IPTV Movies",
        extra: [{ name: "genre", isRequired: false }, { name: "search", isRequired: false }],
      },
      {
        type: "series",
        id: "xtremio_series",
        name: "IPTV Series",
        extra: [{ name: "genre", isRequired: false }, { name: "search", isRequired: false }],
      },
      {
        type: "tv",
        id: "xtremio_live",
        name: "IPTV Live TV",
        extra: [{ name: "genre", isRequired: false }],
      },
    ],
    behaviorHints: {
      adult: false,
      p2p: false,
    },
  };

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
    },
    body: JSON.stringify(manifest),
  };
});
