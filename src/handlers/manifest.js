const crypto = require("crypto");
const { json } = require("../lib/http");
const { providerDisplayName } = require("../lib/provider-config");

async function handleManifest(event, { payload, xtream }) {
  const host = `https://${event.headers.host}`;
  const name = providerDisplayName(payload);

  let genreOptions = [];
  try {
    const cats = await xtream.getCategories();
    genreOptions = (cats?.live || []).map(c => c.category_name).filter(Boolean);
  } catch (err) {
    console.error("[manifest] failed to load categories for genre options", err?.message || err);
  }

  const manifest = {
    id: `com.xtremio.saas.${crypto.createHash("sha256").update(`${payload.serverUrl}|${payload.username || ""}|${name}`).digest("hex").slice(0, 12)}`,
    version: "1.0.0",
    name,
    description: `${name} via Xtream Codes, powered by Xtremio SaaS`,
    logo: `${host}/logo.png`,
    resources: [
      { name: "catalog", types: ["tv"] },
      { name: "meta", types: ["tv"] },
      { name: "stream", types: ["movie", "series", "tv"], idPrefixes: ["tt", "xtream:"] },
    ],
    types: ["movie", "series", "tv"],
    idPrefixes: ["tt", "xtream:"],
    catalogs: [
      {
        type: "tv",
        id: "xtremio_live",
        name: `${name} Live TV`,
        extra: [
          { name: "genre", isRequired: false, options: genreOptions },
          { name: "search" },
        ],
      },
    ],
    behaviorHints: { adult: false, p2p: false },
  };


  return json(200, manifest, { "Cache-Control": "public, max-age=3600" });
}

module.exports = { handleManifest };
