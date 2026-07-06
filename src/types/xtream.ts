export interface AddonConfig {
  BaseURL?: string;
  baseUrl?: string;
  username: string;
  password: string;
  name?: string;
  providerName?: string;
  lang?: string;
  liveContainer?: "m3u8" | "ts";
  authToken?: string;
  sell?: boolean;
}

export interface XtreamCategory {
  category_id: string;
  category_name: string;
  parent_id?: number | string;
}

export interface XtreamVodStream {
  stream_id: number | string;
  name: string;
  year?: string | number;
  container_extension?: string | null;
  stream_icon?: string;
  cover?: string;
  rating?: string;
  releasedate?: string;
}

export interface XtreamSeriesItem {
  series_id: number | string;
  name: string;
  releaseDate?: string;
  release_date?: string;
  year?: string | number;
  cover?: string;
  rating?: string;
}

export interface XtreamLiveStream {
  stream_id: number | string;
  name: string;
  stream_icon?: string;
  category_id?: string;
}

export interface XtreamSeriesEpisode {
  id: number | string;
  episode_num: number;
  season: number;
  title: string;
  container_extension: string;
  info?: {
    releasedate?: string;
    releaseDate?: string;
    movie_image?: string;
  };
}

export interface XtreamSeriesInfo {
  info?: {
    name?: string;
    cover?: string;
  };
  episodes?: Record<string, XtreamSeriesEpisode[]>;
}

export interface XtreamVodInfo {
  info?: {
    name?: string;
    cover_big?: string;
    backdrop?: string | string[];
  };
  movie_data?: {
    name?: string;
    container_extension?: string;
  };
}

export type ProviderIndexEntry =
  | [providerId: number | string, year: string, displayName: string]
  | [providerId: number | string, year: string, ext: string, displayName: string];

export type ProviderIndex = Record<string, ProviderIndexEntry[]>;

export interface TmdbInfo {
  tmdbId: number;
  type: "movie" | "series";
  name: string;
  originalName: string;
  year: string;
}
