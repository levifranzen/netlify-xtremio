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
    resources: [
      { name: "catalog", types: ["tv"] },
      { name: "stream", types: ["movie", "series", "tv"], idPrefixes: ["tt", "xtream:"] },
    ],
    types: ["movie", "series", "tv"],
    idPrefixes: ["tt", "xtream:"],
    catalogs: [
      { type: "tv", id: "xtremio_live", name: `${name} Live TV`, extra: [{ name: "genre" }, { name: "search" }] },
    ],
    behaviorHints: { adult: false, p2p: false },
  };


  return json(200, manifest, { "Cache-Control": "public, max-age=3600" });
}

module.exports = { handleManifest };
