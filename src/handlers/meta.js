const { json } = require("../lib/http");

async function handleMeta(event, { xtream }) {
  const stripped = event.path.replace(/^\/.netlify\/functions\/addon\/[^/]+\/meta\//, "");
  const parts = stripped.split("/");
  const id = decodeURIComponent((parts[1] || "").replace(/\.json$/, ""));

  try {
    const [, itemType, itemId] = id.split(":");

    if (itemType === "live") {
      const streams = await xtream.getLiveStreams();
      const s = streams.find(x => String(x.stream_id) === String(itemId));
      return json(200, { meta: { id, type: "tv", name: s?.name || `Channel ${itemId}`, poster: s?.stream_icon || null }});
    }

    return json(404, { error: "Unknown ID" });
  } catch (err) {
    console.error("[meta]", err.message);
    return json(500, { error: err.message });
  }
}

module.exports = { handleMeta };
