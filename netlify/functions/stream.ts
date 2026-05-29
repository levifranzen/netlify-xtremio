```ts id="2v0o2q"
// /netlify/functions/stream.ts

import type { Handler } from "@netlify/functions";

import { requireAuth } from "../../lib/auth";

const TMDB_API =
  "https://api.themoviedb.org/3";

const TMDB_KEY =
  process.env.TMDB_API_KEY || "";

interface ProviderConfig {
  name: string;

  baseUrl: string;

  username: string;

  password: string;

  matchStrategy: "imdb" | "title_year";
}

const PROVIDERS: Record<string, ProviderConfig> = {
  xtream_a: {
    name: "XTream A",

    baseUrl: "http://provider.com",

    username: "user",

    password: "pass",

    matchStrategy: "imdb",
  },
};

async function fetchJson(
  url: string
): Promise<any> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 Xtremio",
    },
  });

  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status}`
    );
  }

  return res.json();
}

function buildMovieUrl(
  provider: ProviderConfig,
  streamId: string,
  ext = "mkv"
) {
  return `${provider.baseUrl}/movie/${provider.username}/${provider.password}/${streamId}.${ext}`;
}

function buildSeriesUrl(
  provider: ProviderConfig,
  streamId: string,
  ext = "mkv"
) {
  return `${provider.baseUrl}/series/${provider.username}/${provider.password}/${streamId}.${ext}`;
}

async function getTmdbData(
  type: string,
  imdbId: string
) {
  const mediaType =
    type === "series" ? "tv" : "movie";

  const url =
    `${TMDB_API}/${mediaType}/${imdbId}` +
    `?api_key=${TMDB_KEY}` +
    `&external_source=imdb_id`;

  return fetchJson(url);
}

async function searchProviderMovieByImdb(
  provider: ProviderConfig,
  imdbId: string
) {
  const url =
    `${provider.baseUrl}/player_api.php` +
    `?username=${provider.username}` +
    `&password=${provider.password}` +
    `&action=get_vod_streams`;

  const items = await fetchJson(url);

  return items.find(
    (x: any) =>
      x.imdb === imdbId ||
      x.imdb_id === imdbId
  );
}

async function searchProviderSeriesByImdb(
  provider: ProviderConfig,
  imdbId: string
) {
  const url =
    `${provider.baseUrl}/player_api.php` +
    `?username=${provider.username}` +
    `&password=${provider.password}` +
    `&action=get_series`;

  const items = await fetchJson(url);

  return items.find(
    (x: any) =>
      x.imdb === imdbId ||
      x.imdb_id === imdbId
  );
}

async function getSeriesEpisode(
  provider: ProviderConfig,
  seriesId: string,
  season: string,
  episode: string
) {
  const url =
    `${provider.baseUrl}/player_api.php` +
    `?username=${provider.username}` +
    `&password=${provider.password}` +
    `&action=get_series_info` +
    `&series_id=${seriesId}`;

  const data = await fetchJson(url);

  if (
    !data.episodes ||
    !data.episodes[season]
  ) {
    return null;
  }

  const episodes =
    data.episodes[season];

  const target =
    episodes[Number(episode) - 1];

  if (!target) {
    return null;
  }

  return {
    id: target.id,
    ext:
      target.container_extension ||
      "mkv",
  };
}

export const handler: Handler = async (
  event
) => {
  try {
    const token =
      event.queryStringParameters
        ?.token;

    const auth = requireAuth(token);

    const provider =
      PROVIDERS[auth.provider];

    if (!provider) {
      return {
        statusCode: 404,

        body: JSON.stringify({
          error:
            "provider_not_found",
        }),
      };
    }

    const type =
      event.queryStringParameters
        ?.type;

    const id =
      event.queryStringParameters
        ?.id;

    if (!type || !id) {
      return {
        statusCode: 400,

        body: JSON.stringify({
          error:
            "missing_params",
        }),
      };
    }

    const result = {
      streams: [] as any[],
    };

    // MOVIE
    if (type === "movie") {
      const imdbId = id;

      let found =
        await searchProviderMovieByImdb(
          provider,
          imdbId
        );

      if (!found) {
        return {
          statusCode: 404,

          body: JSON.stringify(result),
        };
      }

      result.streams.push({
        name: provider.name,

        url: buildMovieUrl(
          provider,
          found.stream_id,
          found.container_extension
        ),
      });
    }

    // SERIES
    else if (type === "series") {
      const parts = id.split(":");

      const imdbId = parts[0];
      const season = parts[1];
      const episode = parts[2];

      if (
        !imdbId ||
        !season ||
        !episode
      ) {
        return {
          statusCode: 400,

          body: JSON.stringify({
            error:
              "invalid_series_id",
          }),
        };
      }

      const found =
        await searchProviderSeriesByImdb(
          provider,
          imdbId
        );

      if (!found) {
        return {
          statusCode: 404,

          body: JSON.stringify(result),
        };
      }

      const ep =
        await getSeriesEpisode(
          provider,
          found.series_id,
          season,
          episode
        );

      if (!ep) {
        return {
          statusCode: 404,

          body: JSON.stringify(result),
        };
      }

      result.streams.push({
        name: provider.name,

        url: buildSeriesUrl(
          provider,
          ep.id,
          ep.ext
        ),
      });
    }

    return {
      statusCode: 200,

      headers: {
        "Content-Type":
          "application/json",

        "Access-Control-Allow-Origin":
          "*",

        "Cache-Control":
          "public, max-age=60",
      },

      body: JSON.stringify(result),
    };
  } catch (err: any) {
    return {
      statusCode: 401,

      body: JSON.stringify({
        error: err.message,
      }),
    };
  }
};
```
