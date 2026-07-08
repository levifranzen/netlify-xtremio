import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanIptvTitle, firstYear } from "../lib/normalize";
import { getSeries, getVodStreams } from "./xtream";
import type { ProviderIndex, ProviderIndexEntry } from "../types/xtream";

const cacheDir = "/tmp/xtremio-cache";
const memoryCache = new Map<string, ProviderIndex>();

type IndexType = "movie" | "series";

function localIndexPath(providerHash: string, type: IndexType): string {
  return join(cacheDir, `provider-${providerHash}-${type}.json`);
}

export async function loadProviderIndex(providerHash: string, type: IndexType): Promise<ProviderIndex | null> {
  const memoryKey = `${providerHash}:${type}`;
  const inMemory = memoryCache.get(memoryKey);
  if (inMemory) return inMemory;

  try {
    const raw = await readFile(localIndexPath(providerHash, type), "utf8");
    const parsed = JSON.parse(raw) as ProviderIndex;
    memoryCache.set(memoryKey, parsed);
    return parsed;
  } catch {
    return null;
  }
}

async function saveProviderIndex(providerHash: string, type: IndexType, index: ProviderIndex): Promise<void> {
  const memoryKey = `${providerHash}:${type}`;
  memoryCache.set(memoryKey, index);

  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(localIndexPath(providerHash, type), JSON.stringify(index));
  } catch (error) {
    console.warn("Failed to save provider index in /tmp", error);
  }
}

export async function getOrBuildProviderIndex(args: {
  providerHash: string;
  type: IndexType;
  baseUrl: string;
  username: string;
  password: string;
}): Promise<ProviderIndex> {
  const cached = await loadProviderIndex(args.providerHash, args.type);
  if (cached) return cached;

  const index: ProviderIndex = {};

  if (args.type === "series") {
    const allSeries = await getSeries(args.baseUrl, args.username, args.password);

    for (const item of allSeries) {
      const key = cleanIptvTitle(item.name);
      if (!key) continue;

      const entry: ProviderIndexEntry = [
        item.series_id,
        firstYear(item.releaseDate || item.release_date || item.year),
        item.name || "",
      ];

      index[key] ||= [];
      index[key].push(entry);
    }
  } else {
    const allMovies = await getVodStreams(args.baseUrl, args.username, args.password);

    for (const item of allMovies) {
      const key = cleanIptvTitle(item.name);
      if (!key) continue;

      const entry: ProviderIndexEntry = [
        item.stream_id,
        firstYear(item.year),
        item.container_extension || "mp4",
        item.name || "",
      ];

      index[key] ||= [];
      index[key].push(entry);
    }
  }

  await saveProviderIndex(args.providerHash, args.type, index);
  return index;
}
