const reBrackets = /[\[\(].*?[\]\)]/g;
const reTags = /\b(sd|hd|fhd|uhd|4k|8k|h265|hevc|cam|ts|tc|dub|dublado|leg|legendado|l|pt|br|ptbr|dual|audio|3d|vip|vod|alt)\b/gi;

export function normalizeString(value: unknown): string {
  if (typeof value !== "string") return "";

  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "e")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

export function cleanIptvTitle(title: unknown): string {
  if (typeof title !== "string") return "";

  return normalizeString(title.replace(reBrackets, "").replace(reTags, ""));
}

export function firstYear(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = String(value);
  const found = text.match(/\d{4}/);
  return found?.[0] || "";
}

export function safeAscii(value: string): string {
  return /^[\x00-\x7F]*$/.test(value) ? value : "";
}
