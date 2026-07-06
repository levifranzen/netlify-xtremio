import { env } from "../config";
import { getLanguage, getProviderName } from "../lib/configHash";
import { getLiveCategories } from "../services/xtream";
import type { AddonConfig } from "../types/xtream";

export function unconfiguredManifest(origin: string) {
  return {
    id: "org.xtremio.netlify.config",
    version: "0.1.0",
    name: env.addonName,
    description: "Configure your Xtream provider.",
    logo: `${origin}/logo.svg`,
    resources: ["stream", "catalog", "meta"],
    types: ["movie", "series", "tv"],
    catalogs: [],
    idPrefixes: ["tt"],
    behaviorHints: {
      configurable: true,
      configurationRequired: true,
    },
  };
}

export async function configuredManifest(args: {
  origin: string;
  config: AddonConfig;
  baseUrl: string;
  providerHash: string;
  providerHostId: string;
}) {
  const name = getProviderName(args.config, `${args.providerHostId} - ${env.addonName}`);
  const categories = await getLiveCategories(args.baseUrl, args.config.username, args.config.password);
  const genreOptions = categories.map((category) => category.category_name).filter(Boolean);

  return {
    id: `org.xtremio.${args.providerHash}`,
    version: "0.1.0",
    name,
    description: `Xtream provider: ${args.baseUrl}\nLanguage: ${getLanguage(args.config)}`,
    logo: `${args.origin}/logo.svg`,
    resources: ["stream", "catalog", "meta"],
    types: ["movie", "series", "tv"],
    catalogs: [
      {
        type: "tv",
        id: args.providerHash,
        name: `${name} - TV`,
        extra: [
          { name: "genre", options: genreOptions },
          { name: "search" },
          { name: "skip" },
        ],
      },
    ],
    idPrefixes: ["tt", args.providerHash],
    behaviorHints: {
      configurable: !args.config.sell,
      configurationRequired: false,
    },
  };
}
