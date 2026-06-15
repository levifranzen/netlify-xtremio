const crypto = require("crypto");
const { normalize } = require("../lib/normalize");

function cleanLiveChannelName(name) {
  return String(name || "")
    .replace(/\b(SD|FHD|HD|UHD|4K|H265|HEVC|ALT)\b/gi, "")
    .replace(/\[\s*\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function liveGroupKey(name) {
  const cleanName = cleanLiveChannelName(name);
  const words = cleanName.split(/\s+/).filter(Boolean);
  return normalize(words.slice(0, 2).join(" "));
}

function groupLiveChannels(channels) {
  const grouped = {};

  for (const channel of channels || []) {
    const key = liveGroupKey(channel.name);
    if (!key) continue;

    if (!grouped[key]) {
      const displayName = cleanLiveChannelName(channel.name) || channel.name || "Live TV";
      grouped[key] = {
        id: crypto.createHash("md5").update(key).digest("hex"),
        key,
        name: displayName,
        logo: channel.stream_icon || null,
        list: [],
      };
    }

    grouped[key].list.push(channel);

    if (!grouped[key].logo && channel.stream_icon) {
      grouped[key].logo = channel.stream_icon;
    }
  }

  return Object.values(grouped);
}

function findLiveGroupById(channels, groupId) {
  return groupLiveChannels(channels).find(group => String(group.id) === String(groupId));
}

module.exports = { cleanLiveChannelName, liveGroupKey, groupLiveChannels, findLiveGroupById };
