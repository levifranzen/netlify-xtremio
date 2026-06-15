const { json } = require("../lib/http");
const { groupLiveChannels } = require("../services/live-grouping");

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

    if (type === "movie") {
      let items = await xtream.getMovies();
      if (genre) {
        const cats = await xtream.getCategories();
        const cat = cats.movies.find(c => c.category_name === genre);
        if (cat) items = items.filter(m => m.category_id == cat.category_id);
      }
      if (search) items = items.filter(m => m.name?.toLowerCase().includes(search));
      metas = items.slice(skip, skip + PAGE_SIZE).map(m => ({
        id: `xtream:movie:${m.stream_id}:${m.container_extension || "mp4"}`,
        type: "movie", name: m.name, poster: m.stream_icon || null,
        releaseInfo: m.year ? String(m.year) : null,
      }));
    }

    else if (type === "series") {
      let items = await xtream.getSeries();
      if (genre) {
        const cats = await xtream.getCategories();
        const cat = cats.series.find(c => c.category_name === genre);
        if (cat) items = items.filter(s => s.category_id == cat.category_id);
      }
      if (search) items = items.filter(s => s.name?.toLowerCase().includes(search));
      metas = items.slice(skip, skip + PAGE_SIZE).map(s => ({
        id: `xtream:series:${s.series_id}`,
        type: "series", name: s.name, poster: s.cover || null,
        releaseInfo: s.releaseDate?.split("-")[0] || null,
      }));
    }

    else if (type === "tv") {
      let items = await xtream.getLiveStreams();
      if (genre) {
        const cats = await xtream.getCategories();
        const cat = cats.live.find(c => c.category_name === genre);
        if (cat) items = items.filter(s => s.category_id == cat.category_id);
      }
      if (search) items = items.filter(s => s.name?.toLowerCase().includes(search));

      const groups = groupLiveChannels(items);
      metas = groups.slice(skip, skip + PAGE_SIZE).map(g => ({
        id: `xtream:ai:${g.id}`,
        type: "tv",
        name: g.name,
        poster: g.logo || null,
        posterShape: "square",
        description: g.list.map(i => i.name).join("\n"),
      }));
    }

    return json(200, { metas }, { "Cache-Control": "public, max-age=1800" });
  } catch (err) {
    console.error("[catalog]", err.message);
    return json(500, { error: err.message });
  }
}

module.exports = { handleCatalog };
