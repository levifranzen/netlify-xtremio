function providerDisplayName(payload) {
  return String(payload?.providerName || "Xtremio").trim() || "Xtremio";
}

function liveFormat(payload) {
  const format = String(payload?.liveFormat || "m3u8").trim().toLowerCase();
  return format === "ts" ? "ts" : "m3u8";
}

function tmdbLanguage(payload) {
  const lang = String(payload?.tmdbLanguage || process.env.TMDB_LANGUAGE || "pt-BR").trim();
  return /^[a-z]{2}-[A-Z]{2}$/.test(lang) ? lang : "pt-BR";
}

module.exports = { providerDisplayName, liveFormat, tmdbLanguage };
