const { movieYear, seriesYear } = require("../lib/tmdb");

function movieStreamsFromEntries(entries, { xtream, providerName, tmdb }) {
  const fallbackTitle = tmdb?.title || "Movie";
  const year = movieYear(tmdb);
  return (entries || [])
    .map(entry => {
      const id = Number(entry?.[0]);
      const ext = String(entry?.[1] || "mp4").toLowerCase();
      // entry[2] = nome bruto do provider. Entries antigas no cache (formato pre-migracao)
      // nao tem esse campo, entao caem no fallback do titulo do TMDB ate expirarem.
      const rawName = entry?.[2] || fallbackTitle;
      if (!id) return null;
      return {
        name: `${providerName} | ${rawName}`,
        description: year ? `Ano: ${year}` : undefined,
        url: xtream.getMovieStreamUrl(id, ext),
      };
    })
    .filter(Boolean);
}

async function seriesStreamsFromEntries(entries, { xtream, providerName, tmdb, season, episode }) {
  const streams = [];
  const fallbackName = tmdb?.name || "Series";
  const year = seriesYear(tmdb);

  for (const entry of entries || []) {
    const seriesId = Number(Array.isArray(entry) ? entry[0] : entry);
    if (!seriesId) continue;
    // entry[1] = nome bruto do provider. Entries antigas no cache (formato pre-migracao)
    // nao tem esse campo, entao caem no fallback do nome do TMDB ate expirarem.
    const rawName = (Array.isArray(entry) && entry[1]) || fallbackName;

    const info = await xtream.getSeriesInfo(seriesId);
    const eps = info?.episodes?.[String(season)] || [];

    const pattern = new RegExp(`S0?${parseInt(season)}E0?${parseInt(episode)}(?!\\d)`, "i");
    let ep = eps.find(e => pattern.test(e.title || ""));
    if (!ep) ep = eps.find(e => String(e.episode_num) === String(episode));
    if (!ep && eps.length >= parseInt(episode)) ep = eps[parseInt(episode) - 1];

    if (!ep) continue;

    const ext = ep.container_extension || "mp4";
    streams.push({
      name: `${providerName} | ${rawName}`,
      description: year ? `Ano: ${year}` : `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`,
      url: xtream.getEpisodeStreamUrl(ep.id, ext),
    });
    console.log(`[stream] episode found: seriesId=${seriesId} ep=${ep.id} ext=${ext}`);
  }

  return streams;
}

module.exports = { movieStreamsFromEntries, seriesStreamsFromEntries };
