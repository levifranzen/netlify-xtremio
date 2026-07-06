import { createHash } from "node:crypto";
import { domainToASCII } from "node:url";

export function normalizeBaseUrl(rawBaseUrl: string): string {
  const parsed = new URL(rawBaseUrl.replace(/\/+$/, ""));
  parsed.hostname = domainToASCII(parsed.hostname);
  return parsed.toString().replace(/\/+$/, "");
}

export function providerHostId(baseUrl: string): string {
  const host = new URL(baseUrl).hostname;
  return host.split(".")[0] || "xtream";
}

export function providerHash(baseUrl: string, username: string): string {
  return createHash("sha256")
    .update(`${baseUrl}|${username}`)
    .digest("hex")
    .slice(0, 16);
}
