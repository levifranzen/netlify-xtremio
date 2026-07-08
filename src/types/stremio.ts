export type StremioType = "movie" | "series" | "tv";

export interface StremioStream {
  name: string;
  title?: string;
  url: string;
  description?: string;
}

export interface StremioMetaPreview {
  id: string;
  name: string;
  poster?: string;
  posterShape?: "poster" | "square" | "landscape";
  type: StremioType;
  description?: string;
  releaseInfo?: string;
  imdbRating?: string;
}

export interface StremioMeta extends StremioMetaPreview {
  background?: string;
  videos?: Array<{
    id: string;
    title: string;
    season: number;
    episode: number;
    released?: string;
    thumbnail?: string;
  }>;
}
