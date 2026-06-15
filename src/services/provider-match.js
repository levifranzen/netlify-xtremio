const { normalize, cleanIptvTitle } = require("../lib/normalize");

function idFieldFor(item) {
  return item?.series_id ? "series_id" : "stream_id";
}

function itemYear(item) {
  return item?.year || item?.releaseDate?.split?.("-")?.[0] || null;
}

function yearCompatible(item, targetYear) {
  const iy = itemYear(item);
  return !targetYear || !iy || String(iy) === String(targetYear);
}

function itemNormalizedName(item) {
  return item?.norm_name || cleanIptvTitle(item?.name || item?.title || "");
}

// Returns provider items matching a TMDB result.
// Order: provider tmdb_id, exact normalized name with compatible year, exact normalized name fallback.
function findAllMatches(items, tmdbId, matchNames, targetYear = null) {
  const matched = [];
  const seenIds = new Set();

  function addIfNew(item) {
    const field = idFieldFor(item);
    const id = item?.[field];
    if (!id || seenIds.has(String(id))) return;
    seenIds.add(String(id));
    matched.push(item);
  }

  if (tmdbId) {
    (items || [])
      .filter(item => item?.tmdb_id && String(item.tmdb_id) === String(tmdbId))
      .forEach(addIfNew);
  }

  const normalizedNames = [...new Set((matchNames || []).map(normalize).filter(Boolean))];

  for (const normName of normalizedNames) {
    (items || [])
      .filter(item => itemNormalizedName(item) === normName && yearCompatible(item, targetYear))
      .forEach(addIfNew);
  }

  for (const normName of normalizedNames) {
    (items || [])
      .filter(item => itemNormalizedName(item) === normName)
      .forEach(addIfNew);
  }

  return matched;
}

function movieMatchEntriesFromMatches(matches) {
  return [...new Map(
    (matches || [])
      .filter(item => item?.stream_id)
      .map(item => [String(item.stream_id), [Number(item.stream_id), String(item.container_extension || "mp4").toLowerCase()]])
  ).values()];
}

function seriesMatchEntriesFromMatches(matches) {
  return [...new Map(
    (matches || [])
      .filter(item => item?.series_id)
      .map(item => [String(item.series_id), [Number(item.series_id)]])
  ).values()];
}

function idsFromEntries(entries) {
  return (entries || []).map(entry => Number(Array.isArray(entry) ? entry[0] : entry)).filter(Boolean);
}

module.exports = {
  idFieldFor,
  itemYear,
  yearCompatible,
  itemNormalizedName,
  findAllMatches,
  movieMatchEntriesFromMatches,
  seriesMatchEntriesFromMatches,
  idsFromEntries,
};
