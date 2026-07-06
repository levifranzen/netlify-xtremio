import { getLiveCategories, getLiveStreams } from "../services/xtream";
import { groupChannels } from "../services/live";
import type { AddonConfig } from "../types/xtream";
import type { StremioMetaPreview } from "../types/stremio";

export async function tvCatalog(args: {
  config: AddonConfig;
  baseUrl: string;
  providerHash: string;
  catalogId: string;
  genre?: string;
  search?: string;
}): Promise<{ metas: StremioMetaPreview[] }> {
  if (args.catalogId !== args.providerHash) return { metas: [] };

  let categoryId: string | undefined;

  if (args.genre) {
    const categories = await getLiveCategories(args.baseUrl, args.config.username, args.config.password);
    categoryId = categories.find((category) => category.category_name === args.genre)?.category_id;
    if (!categoryId) return { metas: [] };
  }

  const channels = await getLiveStreams(args.baseUrl, args.config.username, args.config.password, categoryId);
  const needle = (args.search || "").trim().toLowerCase();
  const filtered = needle
    ? channels.filter((channel) => (channel.name || "").toLowerCase().includes(needle))
    : channels;

  const grouped = groupChannels(filtered);
  const metas = Object.values(grouped).map((group) => ({
    id: `${args.providerHash}:ai:${group.id}`,
    name: group.name,
    poster: group.logo,
    posterShape: "square" as const,
    type: "tv" as const,
    description: group.list.map((channel) => channel.name).join("\n"),
  }));

  return { metas };
}
