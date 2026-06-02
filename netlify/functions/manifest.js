/**
 * manifest.js — /.netlify/functions/manifest/:token/manifest.json
 *
 * Returns the Stremio addon manifest scoped to this user's token.
 * The manifest URL itself is what the user installs in Stremio.
 */

const { withAuth, jsonResponse } = require("../../src/lib/middleware");

exports.handler = withAuth(async (event, context, { payload }) => {
  const { serverUrl } = payload;

  // Build the base URL for this addon install
  const host = `https://${event.headers.host}/.netlify/functions`;
  const token = event.path.split("/")[3]; // extract token segment

  const manifest = {
    id: `com.xtremio.saas.${Buffer.from(serverUrl).toString("base64url").slice(0, 12)}`,
    version: "1.0.0",
    name: "Xtremio",
    description: "Your IPTV provider via Xtream Codes, powered by Xtremio SaaS",
    logo: `${host.replace("/.netlify/functions", "")}/logo.png`,
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
