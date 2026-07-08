import type { Handler, HandlerEvent, HandlerResponse } from "@netlify/functions";
import { decodeConfig } from "../../src/lib/configHash";
import { normalizeBaseUrl, providerHash as makeProviderHash, providerHostId } from "../../src/lib/providerHash";
import { configurePage } from "../../src/configurePage";
import { logoSvg } from "../../src/logo";
import { authAllowed } from "../../src/services/auth";
import { configuredManifest, unconfiguredManifest } from "../../src/stremio/manifest";
import { tvCatalog } from "../../src/stremio/catalog";
import { tvMeta } from "../../src/stremio/meta";
import { streamsFor } from "../../src/stremio/stream";
import type { StremioType } from "../../src/types/stremio";

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return response("", 204, { "access-control-allow-methods": "GET,POST,OPTIONS" });
  }

  try {
    return await route(event);
  } catch (error) {
    console.error(error);
    return json({ error: "Internal error" }, 500);
  }
};

async function route(event: HandlerEvent): Promise<HandlerResponse> {
  const origin = event.headers.host ? `https://${event.headers.host}` : "";
  const segments = pathSegments(event);

  if (segments.length === 0 || segments[0] === "configure") {
    return response(configurePage(), 200, { "content-type": "text/html; charset=utf-8" });
  }

  if (segments[0] === "logo.svg") {
    return response(logoSvg, 200, { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=86400" });
  }

  if (segments.length === 1 && segments[0] === "manifest.json") {
    return json(unconfiguredManifest(origin));
  }

  const [hash, resource] = segments;
  if (!hash || !resource) return json({ error: "Not found" }, 404);

  let config;
  try {
    config = decodeConfig(hash);
  } catch {
    return json({ error: "Invalid hash" }, 400);
  }

  if (!authAllowed(config, fakeRequest(event))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const baseUrl = normalizeBaseUrl(config.baseUrl || config.BaseURL || "");
  const pHash = makeProviderHash(baseUrl, config.username);
  const hostId = providerHostId(baseUrl);

  if (resource === "manifest.json") {
    const manifest = await configuredManifest({
      origin,
      config,
      baseUrl,
      providerHash: pHash,
      providerHostId: hostId,
    });

    return json(manifest, 200, { "cache-control": "public, max-age=60, s-maxage=300" });
  }

  if (resource === "stream") {
    const type = segments[2] as StremioType | undefined;
    const id = stripJson(segments[3] || "");
    if (!isStremioType(type) || !id) return json({ streams: [] });

    const result = await streamsFor({ config, baseUrl, providerHash: pHash, type, id });
    return json(result, 200, { "cache-control": "no-store" });
  }

  if (resource === "catalog") {
    const type = segments[2] as StremioType | undefined;
    const catalogId = segments[3];
    const extra = stripJson(segments[4] || "");

    if (type !== "tv" || !catalogId) return json({ metas: [] });

    const { genre, search } = parseExtra(extra);
    const result = await tvCatalog({ config, baseUrl, providerHash: pHash, catalogId, genre, search });
    return json(result, 200, { "cache-control": "public, max-age=60, s-maxage=120" });
  }

  if (resource === "meta") {
    const type = segments[2] as StremioType | undefined;
    const id = stripJson(segments[3] || "");

    if (type !== "tv" || !id) return json({ meta: {} });

    const result = await tvMeta({ config, baseUrl, providerHash: pHash, id });
    return json(result, 200, { "cache-control": "public, max-age=60, s-maxage=300" });
  }

  if (resource === "data") {
    return json({ ...config, password: "***" });
  }

  return json({ error: "Not found" }, 404);
}

function pathSegments(event: HandlerEvent): string[] {
  const rawUrl = event.rawUrl || `https://${event.headers.host || "localhost"}${event.path}`;
  const url = new URL(rawUrl);
  let pathname = url.pathname;

  const functionPrefix = "/.netlify/functions/addon";
  if (pathname.startsWith(functionPrefix)) {
    pathname = pathname.slice(functionPrefix.length) || "/";
  }

  return pathname
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
}

function stripJson(value: string): string {
  return value.endsWith(".json") ? value.slice(0, -5) : value;
}

function parseExtra(extra: string): { genre?: string; search?: string } {
  if (!extra) return {};

  const [key, ...rest] = extra.split("=");
  const value = rest.join("=");

  if (key === "genre") return { genre: value };
  if (key === "search") return { search: value };

  return {};
}

function isStremioType(value: string | undefined): value is StremioType {
  return value === "movie" || value === "series" || value === "tv";
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): HandlerResponse {
  return response(JSON.stringify(body), status, {
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
}

function response(body: string, statusCode = 200, headers: Record<string, string> = {}): HandlerResponse {
  return {
    statusCode,
    headers: {
      "access-control-allow-origin": "*",
      ...headers,
    },
    body,
  };
}

function fakeRequest(event: HandlerEvent): Request {
  const rawUrl = event.rawUrl || `https://${event.headers.host || "localhost"}${event.path}`;
  return new Request(rawUrl, { headers: event.headers as HeadersInit });
}
