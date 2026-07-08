import crypto from "node:crypto";
import { normalizeString } from "../lib/normalize";
import type { XtreamLiveStream } from "../types/xtream";

export interface LiveGroup {
  id: string;
  name: string;
  logo: string;
  list: XtreamLiveStream[];
}

export function groupChannels(channels: XtreamLiveStream[]): Record<string, LiveGroup> {
  const grouped: Record<string, LiveGroup> = {};

  for (const channel of channels) {
    const cleanName = (channel.name || "")
      .replace(/\b(SD|FHD|HD|4K|H265|Alt)\b/gi, "")
      .replace(/\[\]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const keywords = cleanName.split(" ").filter(Boolean);
    const groupKey = normalizeString(keywords.slice(0, 2).join(" "));
    if (!groupKey) continue;

    grouped[groupKey] ||= {
      id: crypto.createHash("md5").update(groupKey).digest("hex"),
      name: cleanName,
      logo: channel.stream_icon || "",
      list: [],
    };

    grouped[groupKey].list.push(channel);

    if (!grouped[groupKey].logo && channel.stream_icon) {
      grouped[groupKey].logo = channel.stream_icon;
    }
  }

  return grouped;
}
