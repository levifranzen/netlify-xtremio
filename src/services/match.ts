import { normalizeString, safeAscii } from "../lib/normalize";
import { getOrBuildProviderIndex } from "./providerIndex";
import { exists, getJson, setJson } from "./redis";
import type { ProviderIndexEntry, TmdbInfo } from "../types/xtream";

type MatchType = "movie" | "series";

export async function getProviderMatches(args: {
  providerHash: string;
  type: MatchType;
  tmdb: TmdbInfo;
  baseUrl: string;
  username: string;
  password: string;
}): Promise<ProviderIndexEntry[]> {
  const matchKey = `match:${args.providerHash}:${args.type}:${args.tmdb.tmdbId}`;
  const missKey = `miss:${args.providerHash}:${args.type}:${args.tmdb.tmdbId}`;

  const cached = await getJson<ProviderIndexEntry[]>(matchKey);
  if (cached) return cached;

  if (await exists(missKey)) return [];

  const index = await getOrBuildProviderIndex({
    providerHash: args.providerHash,
    type: args.type,
    baseUrl: args.baseUrl,
    username: args.username,
    password: args.password,
  });

  const targetName = normalizeString(args.tmdb.name);
  const originalName = normalizeString(safeAscii(args.tmdb.originalName));
  const matched: ProviderIndexEntry[] = [];

  if (targetName && index[targetName]) matched.push(...index[targetName]);
  if (originalName && originalName !== targetName && index[originalName]) matched.push(...index[originalName]);

  const deduped = dedupeMatches(matched);

  if (deduped.length > 0) {
    await setJson(matchKey, deduped);
  } else {
    await setJson(missKey, { ts: Date.now() }, 60 * 60 * 12);
  }

  return deduped;
}

function dedupeMatches(matches: ProviderIndexEntry[]): ProviderIndexEntry[] {
  const seen = new Set<string>();
  const result: ProviderIndexEntry[] = [];

  for (const match of matches) {
    const key = JSON.stringify(match);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(match);
  }

  return result;
}
