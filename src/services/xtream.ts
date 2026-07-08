import { fetchJson } from "../lib/http";
import type {
  XtreamCategory,
  XtreamLiveStream,
  XtreamSeriesInfo,
  XtreamSeriesItem,
  XtreamVodInfo,
  XtreamVodStream,
} from "../types/xtream";

function playerApiUrl(baseUrl: string, username: string, password: string, params: Record<string, string | number> = {}): string {
  const url = new URL(`${baseUrl}/player_api.php`);
  url.searchParams.set("username", username);
  url.searchParams.set("password", password);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

export async function getAccountInfo(baseUrl: string, username: string, password: string): Promise<Record<string, any> | null> {
  return fetchJson<Record<string, any>>(playerApiUrl(baseUrl, username, password), 10000);
}

export async function getVodCategories(baseUrl: string, username: string, password: string): Promise<XtreamCategory[]> {
  return (await fetchJson<XtreamCategory[]>(playerApiUrl(baseUrl, username, password, { action: "get_vod_categories" }))) || [];
}

export async function getSeriesCategories(baseUrl: string, username: string, password: string): Promise<XtreamCategory[]> {
  return (await fetchJson<XtreamCategory[]>(playerApiUrl(baseUrl, username, password, { action: "get_series_categories" }))) || [];
}

export async function getLiveCategories(baseUrl: string, username: string, password: string): Promise<XtreamCategory[]> {
  return (await fetchJson<XtreamCategory[]>(playerApiUrl(baseUrl, username, password, { action: "get_live_categories" }))) || [];
}

export async function getVodStreams(baseUrl: string, username: string, password: string): Promise<XtreamVodStream[]> {
  return (await fetchJson<XtreamVodStream[]>(playerApiUrl(baseUrl, username, password, { action: "get_vod_streams" }), 30000)) || [];
}

export async function getSeries(baseUrl: string, username: string, password: string): Promise<XtreamSeriesItem[]> {
  return (await fetchJson<XtreamSeriesItem[]>(playerApiUrl(baseUrl, username, password, { action: "get_series" }), 30000)) || [];
}

export async function getLiveStreams(
  baseUrl: string,
  username: string,
  password: string,
  categoryId?: string,
): Promise<XtreamLiveStream[]> {
  const params: Record<string, string> = { action: "get_live_streams" };
  if (categoryId) params.category_id = categoryId;

  return (await fetchJson<XtreamLiveStream[]>(playerApiUrl(baseUrl, username, password, params), 30000)) || [];
}

export async function getSeriesInfo(
  baseUrl: string,
  username: string,
  password: string,
  seriesId: string | number,
): Promise<XtreamSeriesInfo | null> {
  return fetchJson<XtreamSeriesInfo>(playerApiUrl(baseUrl, username, password, { action: "get_series_info", series_id: seriesId }), 15000);
}

export async function getVodInfo(
  baseUrl: string,
  username: string,
  password: string,
  vodId: string | number,
): Promise<XtreamVodInfo | null> {
  return fetchJson<XtreamVodInfo>(playerApiUrl(baseUrl, username, password, { action: "get_vod_info", vod_id: vodId }), 15000);
}

export function movieUrl(baseUrl: string, username: string, password: string, providerId: string | number, ext = "mp4"): string {
  return `${baseUrl}/movie/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${providerId}.${ext}`;
}

export function seriesUrl(baseUrl: string, username: string, password: string, episodeId: string | number, ext = "mp4"): string {
  return `${baseUrl}/series/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${episodeId}.${ext}`;
}

export function liveUrl(baseUrl: string, username: string, password: string, streamId: string | number, ext: "m3u8" | "ts"): string {
  return `${baseUrl}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${ext}`;
}
