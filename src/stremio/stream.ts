import { getLanguage, getLiveContainer } from "../lib/configHash";
import { getTmdbInfo } from "../services/tmdb";
import { getProviderMatches } from "../services/match";
import { getLiveStreams, getSeriesInfo, getVodInfo, liveUrl, movieUrl, seriesUrl } from "../services/xtream";
import { groupChannels } from "../services/live";
import type { AddonConfig, ProviderIndexEntry } from "../types/xtream";
import type { StremioStream, StremioType } from "../types/stremio";

export async function streamsFor(args: {
  config: AddonConfig;
  baseUrl: string;
  providerHash: string;
  type: StremioType;
  id: string;
}): Promise<{ streams: StremioStream[] }> {
  if (args.type === "tv") return tvStreams(args);
  if (args.type === "movie") return movieStreams(args);
  if (args.type === "series") return seriesStreams(args);

  return { streams: [] };
}

async function tvStreams(args: {
  config: AddonConfig;
  baseUrl: string;
  providerHash: string;
  id: string;
}): Promise<{ streams: StremioStream[] }> {
  const liveContainer = getLiveContainer(args.config);
  const parsed = parseProviderId(args.id, args.providerHash);
  if (!parsed) return { streams: [] };

  const channels = await getLiveStreams(args.baseUrl, args.config.username, args.config.password);

  if (parsed.groupId) {
    const groups = groupChannels(channels);
    const group = Object.values(groups).find((item) => item.id === parsed.groupId);

    return {
      streams:
        group?.list.map((channel) => ({
          name: channel.name,
          url: liveUrl(args.baseUrl, args.config.username, args.config.password, channel.stream_id, liveContainer),
        })) || [],
    };
  }

  if (!parsed.contentId) return { streams: [] };

  const channel = channels.find((item) => String(item.stream_id) === parsed.contentId);
  if (!channel) return { streams: [] };

  return {
    streams: [
      {
        name: channel.name,
        url: liveUrl(args.baseUrl, args.config.username, args.config.password, channel.stream_id, liveContainer),
      },
    ],
  };
}

async function movieStreams(args: {
  config: AddonConfig;
  baseUrl: string;
  providerHash: string;
  id: string;
}): Promise<{ streams: StremioStream[] }> {
  if (!args.id.startsWith("tt")) {
    const parsed = parseProviderId(args.id, args.providerHash);
    if (!parsed?.contentId) return { streams: [] };

    const vodInfo = await getVodInfo(args.baseUrl, args.config.username, args.config.password, parsed.contentId);
    const ext = vodInfo?.movie_data?.container_extension || "mp4";
    const name = vodInfo?.info?.name || vodInfo?.movie_data?.name || `Movie ${parsed.contentId}`;

    return {
      streams: [
        {
          name,
          url: movieUrl(args.baseUrl, args.config.username, args.config.password, parsed.contentId, ext),
        },
      ],
    };
  }

  const tmdb = await getTmdbInfo(args.id, getLanguage(args.config), "movie");
  if (!tmdb) return { streams: [] };

  const matches = await getProviderMatches({
    providerHash: args.providerHash,
    type: "movie",
    tmdb,
    baseUrl: args.baseUrl,
    username: args.config.username,
    password: args.config.password,
  });

  const streams = matches.flatMap((entry) => {
    if (!isMovieEntry(entry)) return [];

    const [providerId, year, ext, displayName] = entry;
    if (tmdb.year && year && year !== "0" && year !== "None" && year !== tmdb.year) return [];

    return [
      {
        name: `ST | ${displayName}`,
        url: movieUrl(args.baseUrl, args.config.username, args.config.password, providerId, ext),
        description: year ? `Ano: ${year}` : "",
      },
    ];
  });

  return { streams };
}

async function seriesStreams(args: {
  config: AddonConfig;
  baseUrl: string;
  providerHash: string;
  id: string;
}): Promise<{ streams: StremioStream[] }> {
  const parsedSeries = parseSeriesId(args.id, args.providerHash);
  if (!parsedSeries) return { streams: [] };

  if (!parsedSeries.imdbId) {
    return nativeSeriesStreams({ ...args, providerSeriesId: parsedSeries.providerSeriesId, season: parsedSeries.season, episode: parsedSeries.episode });
  }

  const tmdb = await getTmdbInfo(parsedSeries.imdbId, getLanguage(args.config), "series");
  if (!tmdb) return { streams: [] };

  const matches = await getProviderMatches({
    providerHash: args.providerHash,
    type: "series",
    tmdb,
    baseUrl: args.baseUrl,
    username: args.config.username,
    password: args.config.password,
  });

  const streams: StremioStream[] = [];

  for (const entry of matches) {
    if (!isSeriesEntry(entry)) continue;

    const [seriesId, itemYear, displayName] = entry;
    if (tmdb.year && itemYear && itemYear !== "0" && itemYear !== "None" && itemYear !== tmdb.year) continue;

    const info = await getSeriesInfo(args.baseUrl, args.config.username, args.config.password, seriesId);
    const found = findEpisode(info, parsedSeries.season, parsedSeries.episode);
    if (!found) continue;

    streams.push({
      name: ` | ${displayName}`,
      url: seriesUrl(args.baseUrl, args.config.username, args.config.password, found.id, found.container_extension || "mp4"),
      description: itemYear ? `Ano: ${itemYear}` : "",
    });
  }

  return { streams };
}

async function nativeSeriesStreams(args: {
  config: AddonConfig;
  baseUrl: string;
  providerSeriesId: string;
  season: string;
  episode: string;
}): Promise<{ streams: StremioStream[] }> {
  const info = await getSeriesInfo(args.baseUrl, args.config.username, args.config.password, args.providerSeriesId);
  const found = findEpisode(info, args.season, args.episode);

  if (!found) return { streams: [] };

  return {
    streams: [
      {
        name: found.title || `S${args.season}E${args.episode}`,
        url: seriesUrl(args.baseUrl, args.config.username, args.config.password, found.id, found.container_extension || "mp4"),
      },
    ],
  };
}

function findEpisode(info: Awaited<ReturnType<typeof getSeriesInfo>>, season: string, episode: string) {
  const episodes = info?.episodes?.[String(Number(season))] || info?.episodes?.[season];
  if (!episodes?.length) return null;

  const pattern = new RegExp(`S0?${Number(season)}E0?${Number(episode)}(?!\\d)`, "i");
  const byTitle = episodes.find((item) => pattern.test(item.title || ""));
  if (byTitle) return byTitle;

  return episodes[Number(episode) - 1] || null;
}

function parseProviderId(id: string, providerHash: string): { contentId?: string; groupId?: string } | null {
  const parts = id.split(":");
  if (parts[0] !== providerHash) return null;

  if (parts[1] === "ai" && parts[2]) return { groupId: parts[2] };
  if (parts[1]) return { contentId: parts[1] };

  return null;
}

function parseSeriesId(
  id: string,
  providerHash: string,
): { imdbId?: string; providerSeriesId: string; season: string; episode: string } | null {
  if (id.startsWith("tt")) {
    const [imdbId, season, episode] = id.split(":");
    if (!imdbId || !season || !episode) return null;
    return { imdbId, providerSeriesId: "", season, episode };
  }

  const [prefix, providerSeriesId, season, episode] = id.split(":");
  if (prefix !== providerHash || !providerSeriesId || !season || !episode) return null;

  return { providerSeriesId, season, episode };
}

function isMovieEntry(entry: ProviderIndexEntry): entry is [string | number, string, string, string] {
  return entry.length === 4;
}

function isSeriesEntry(entry: ProviderIndexEntry): entry is [string | number, string, string] {
  return entry.length === 3;
}
