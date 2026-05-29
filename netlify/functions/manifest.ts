# `netlify/functions/manifest.ts`

```ts
import type { Handler } from "@netlify/functions";

const VERSION = "2.0.0";

export const handler: Handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};

    const provider = params.provider || "default";
    const name = params.name || `${provider} - Xtream`;
    const baseUrl = params.baseUrl || "";

    // Aqui no futuro você pode:
    // - validar token
    // - buscar provider config no Redis
    // - aplicar feature flags
    // - validar assinatura/hash

    const manifest = {
      id: `org.xtremio.${provider}`,
      version: VERSION,

      name,

      description:
        "Ultra lightweight Xtream middleware for Stremio",

      logo:
        "https://your-domain.netlify.app/logo.png",

      background:
        "https://your-domain.netlify.app/background.jpg",

      resources: [
        "stream",
        "meta",
        "catalog"
      ],

      types: [
        "movie",
        "series",
        "tv"
      ],

      idPrefixes: [
        "tt"
      ],

      behaviorHints: {
        configurable: true,
        configurationRequired: false,
      },

      catalogs: [
        {
          type: "movie",
          id: `${provider}_movies`,
          name: `${name} Movies`,
          extra: [
            { name: "search" },
            { name: "skip" },
            { name: "genre" }
          ]
        },

        {
          type: "series",
          id: `${provider}_series`,
          name: `${name} Series`,
          extra: [
            { name: "search" },
            { name: "skip" },
            { name: "genre" }
          ]
        },

        {
          type: "tv",
          id: `${provider}_tv`,
          name: `${name} TV`,
          extra: [
            { name: "search" }
          ]
        }
      ]
    };

    return {
      statusCode: 200,

      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300"
      },

      body: JSON.stringify(manifest),
    };
  } catch (err: any) {
    return {
      statusCode: 500,

      body: JSON.stringify({
        error: "manifest_error",
        message: err.message
      }),
    };
  }
};
```
