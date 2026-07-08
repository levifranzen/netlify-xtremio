import type { AddonConfig } from "../types/xtream";

export function encodeConfig(config: AddonConfig): string {
  const json = JSON.stringify(config);
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeConfig(hash: string): AddonConfig {
  const decoded = Buffer.from(hash, "base64url").toString("utf8");
  const config = JSON.parse(decoded) as AddonConfig;

  if (!getBaseUrl(config) || !config.username || !config.password) {
    throw new Error("Invalid config hash");
  }

  return config;
}

export function getBaseUrl(config: AddonConfig): string {
  return (config.baseUrl || config.BaseURL || "").replace(/\/+$/, "");
}

export function getProviderName(config: AddonConfig, fallback: string): string {
  return config.providerName || config.name || fallback;
}

export function getLanguage(config: AddonConfig): string {
  return config.lang || "pt-BR";
}

export function getLiveContainer(config: AddonConfig): "m3u8" | "ts" {
  return config.liveContainer === "ts" ? "ts" : "m3u8";
}
