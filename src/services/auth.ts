import { env } from "../config";
import type { AddonConfig } from "../types/xtream";

// Preparado para uso futuro, mas propositalmente não obrigatório agora.
export function authAllowed(config: AddonConfig, request: Request): boolean {
  if (!env.addonAuthToken && !config.authToken) return true;

  const url = new URL(request.url);
  const token = request.headers.get("x-addon-token") || url.searchParams.get("token") || "";
  const expected = config.authToken || env.addonAuthToken;

  return Boolean(expected && token === expected);
}
