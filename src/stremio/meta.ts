import { getLiveStreams } from "../services/xtream";
import { groupChannels } from "../services/live";
import type { AddonConfig } from "../types/xtream";
import type { StremioMeta } from "../types/stremio";

export async function tvMeta(args: {
  config: AddonConfig;
  baseUrl: string;
  providerHash: string;
  id: string;
}): Promise<{ meta: StremioMeta | Record<string, never> }> {
  const parsed = parseTvId(args.id, args.providerHash);
  if (!parsed) return { meta: {} };

  const channels = await getLiveStreams(args.baseUrl, args.config.username, args.config.password);

  if (parsed.groupId) {
    const groups = groupChannels(channels);
    const group = Object.values(groups).find((item) => item.id === parsed.groupId);

    if (!group) return { meta: {} };

    return {
      meta: {
        id: `${args.providerHash}:ai:${group.id}`,
        name: group.name,
        poster: group.logo,
        background: group.logo,
        type: "tv",
      },
    };
  }

  const channel = channels.find((item) => String(item.stream_id) === parsed.streamId);
  if (!channel) return { meta: {} };

  return {
    meta: {
      id: `${args.providerHash}:${channel.stream_id}`,
      name: channel.name,
      poster: channel.stream_icon || "",
      background: channel.stream_icon || "",
      type: "tv",
    },
  };
}

function parseTvId(id: string, providerHash: string): { groupId?: string; streamId?: string } | null {
  const parts = id.split(":");
  if (parts[0] !== providerHash) return null;

  if (parts[1] === "ai" && parts[2]) return { groupId: parts[2] };
  if (parts[1]) return { streamId: parts[1] };

  return null;
}
