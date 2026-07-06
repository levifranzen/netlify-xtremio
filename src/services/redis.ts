import { env } from "../config";

function enabled(): boolean {
  return Boolean(env.redisUrl && env.redisToken);
}

async function redisCommand<T>(command: unknown[]): Promise<T | null> {
  if (!enabled()) return null;

  try {
    const response = await fetch(env.redisUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.redisToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    });

    if (!response.ok) {
      console.warn(`Redis HTTP ${response.status}`);
      return null;
    }

    const payload = (await response.json()) as { result?: T; error?: string };
    if (payload.error) {
      console.warn(`Redis error: ${payload.error}`);
      return null;
    }

    return payload.result ?? null;
  } catch (error) {
    console.warn("Redis command failed", error);
    return null;
  }
}

export async function getJson<T>(key: string): Promise<T | null> {
  const raw = await redisCommand<string>(["GET", key]);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  const encoded = JSON.stringify(value);
  if (ttlSeconds && ttlSeconds > 0) {
    await redisCommand(["SET", key, encoded, "EX", ttlSeconds]);
    return;
  }

  await redisCommand(["SET", key, encoded]);
}

export async function exists(key: string): Promise<boolean> {
  const result = await redisCommand<number>(["EXISTS", key]);
  return result === 1;
}
