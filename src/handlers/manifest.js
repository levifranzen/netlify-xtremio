const crypto = require("crypto");
const { json } = require("../lib/http");
const { providerDisplayName } = require("../lib/provider-config");

function handleManifest(event, payload) {
  const host = `https://${event.headers.host}`;
  const name = providerDisplayName(payload);

  const manifest = {
    id: `com.xtremio.saas.${crypto.createHash("sha256").update(`${payload.serverUrl}|${payload.username || ""}|${name}`).digest("hex").slice(0, 12)}`,
    version: "1.0.0",
    name,
    description: `${name} via Xtream Codes, powered by Xtremio SaaS`,
    logo: `${host}/logo.png`,
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["tt", "xtream:"],
    catalogs: [
      { type: "movie",  id: "xtremio_movies", name: `${name} Movies`,  extra: [{ name: "genre" }, { name: "search" }] },
      { type: "series", id: "xtremio_series", name: `${name} Series`,  extra: [{ name: "genre" }, { name: "search" }] },
      { type: "tv",     id: "xtremio_live",   name: `${name} Live TV`, extra: [{ name: "genre" }] },
    ],
    behaviorHints: { adult: false, p2p: false },
  };


  return json(200, manifest, { "Cache-Control": "public, max-age=3600" });
}

module.exports = { handleManifest };
