import { env } from "../config";
import { fetchJson } from "../lib/http";
import { firstYear } from "../lib/normalize";
import { getJson, setJson } from "./redis";
import type { TmdbInfo } from "../types/xtream";

type TmdbFindResponse = {
  movie_results?: Array<{
    id: number;
    title?: string;
    original_title?: string;
    release_date?: string;
  }>;
  tv_results?: Array<{
    id: number;
    name?: string;
    original_name?: string;
    first_air_date?: string;
  }>;
};

export async function getTmdbInfo(imdbId: string, lang = "pt-BR", expectedType?: "movie" | "series"): Promise<TmdbInfo | null> {
  const cacheKey = `tmdb:${lang}:${imdbId}`;
  const cached = await getJson<TmdbInfo>(cacheKey);

  if (cached && (!expectedType || cached.type === expectedType)) {
    return cached;
  }

  if (!env.tmdbApiKey) {
    console.warn("TMDB_API_KEY is missing");
    return null;
  }

  const url = new URL(`https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}`);
  url.searchParams.set("api_key", env.tmdbApiKey);
  url.searchParams.set("external_source", "imdb_id");
  url.searchParams.set("language", lang);

  const program = await fetchJson<TmdbFindResponse>(url.toString(), 12000);
  if (!program) return null;

  let result: TmdbInfo | null = null;

  if (expectedType !== "movie" && program.tv_results?.length) {
    const tv = program.tv_results[0];
    result = {
      tmdbId: tv.id,
      type: "series",
      name: tv.name || "",
      originalName: tv.original_name || "",
      year: firstYear(tv.first_air_date),
    };
  } else if (expectedType !== "series" && program.movie_results?.length) {
    const movie = program.movie_results[0];
    result = {
      tmdbId: movie.id,
      type: "movie",
      name: movie.title || "",
      originalName: movie.original_title || "",
      year: firstYear(movie.release_date),
    };
  }

  if (result) {
    await setJson(cacheKey, result);
  }

  return result;
}
