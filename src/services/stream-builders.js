const { movieYear, seriesYear } = require("../lib/tmdb");
const { idsFromEntries } = require("./provider-match");

function buildVideos(info) {
  const videos = [];
  for (const [season, eps] of Object.entries(info?.episodes || {})) {
    for (const ep of eps) {
      videos.push({
        id:       `xtream:ep:${ep.id}:${ep.container_extension || "mp4"}`,
        title:    ep.title || `Episode ${ep.episode_num}`,
        season:   parseInt(season),
        episode:  parseInt(ep.episode_num),
        released: ep.added ? new Date(parseInt(ep.added) * 1000).toISOString() : null,
        overview:  ep.info?.plot || null,
        thumbnail: ep.info?.movie_image || null,
      });
    }
  }
  return videos.sort((a, b) => a.season - b.season || a.episode - b.episode);
}

function movieStreamsFromEntries(entries, { xtream, providerName, tmdb }) {
  const title = tmdb?.title || "Movie";
  const year = movieYear(tmdb);
  return (entries || [])
    .map(entry => {
      const id = Number(entry?.[0]);
      const ext = String(entry?.[1] || "mp4").toLowerCase();
      if (!id) return null;
      return {
        name: `${providerName} | ${title}`,
        description: year ? `Ano: ${year}` : undefined,
        url: xtream.getMovieStreamUrl(id, ext),
      };
    })
    .filter(Boolean);
}

async function seriesStreamsFromEntries(entries, { xtream, providerName, tmdb, season, episode }) {
  const streams = [];
  const seriesName = tmdb?.name || "Series";
  const year = seriesYear(tmdb);

  for (const seriesId of idsFromEntries(entries)) {
    const info = await xtream.getSeriesInfo(seriesId);
    const eps = info?.episodes?.[String(season)] || [];

    const pattern = new RegExp(`S0?${parseInt(season)}E0?${parseInt(episode)}(?!\\d)`, "i");
    let ep = eps.find(e => pattern.test(e.title || ""));
    if (!ep) ep = eps.find(e => String(e.episode_num) === String(episode));
    if (!ep && eps.length >= parseInt(episode)) ep = eps[parseInt(episode) - 1];

    if (!ep) continue;

    const ext = ep.container_extension || "mp4";
    streams.push({
      name: `${providerName} | ${seriesName}`,
      description: year ? `Ano: ${year}` : `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`,
      url: xtream.getEpisodeStreamUrl(ep.id, ext),
    });
    console.log(`[stream] episode found: seriesId=${seriesId} ep=${ep.id} ext=${ext}`);
  }

  return streams;
}

module.exports = { buildVideos, movieStreamsFromEntries, seriesStreamsFromEntries };
