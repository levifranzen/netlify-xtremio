const { json } = require("../lib/http");

const PAGE_SIZE = 100;

async function handleCatalog(event, { xtream }) {
  const stripped = event.path.replace(/^\/.netlify\/functions\/addon\/[^/]+\/catalog\//, "");
  const parts = stripped.split("/");
  const type = parts[0];

  // Extra params: genre=Action or search=batman encoded in last segment
  const extraStr = (parts[2] || parts[1] || "").replace(/\.json$/, "");
  const extra = {};
  extraStr.split("&").forEach(p => {
    const [k, v] = p.split("=");
    if (k && v !== undefined) extra[k] = decodeURIComponent(v);
  });

  const skip   = parseInt(extra.skip || "0");
  const genre  = extra.genre || null;
  const search = extra.search ? extra.search.toLowerCase() : null;

  try {
    let metas = [];

    if (type === "tv") {
      let items = await xtream.getLiveStreams();
      if (genre) {
        const cats = await xtream.getCategories();
        const cat = cats.live.find(c => c.category_name === genre);
        if (cat) items = items.filter(s => s.category_id == cat.category_id);
      }
      if (search) items = items.filter(s => s.name?.toLowerCase().includes(search));

      metas = items.slice(skip, skip + PAGE_SIZE).map(s => ({
        id: `xtream:live:${s.stream_id}`,
        type: "tv",
        name: s.name,
        poster: s.stream_icon || null,
        posterShape: "square",
      }));
    }

    return json(200, { metas }, { "Cache-Control": "public, max-age=1800" });
  } catch (err) {
    console.error("[catalog]", err.message);
    return json(500, { error: err.message });
  }
}

module.exports = { handleCatalog };
