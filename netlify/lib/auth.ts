// /lib/auth.ts

import crypto from "crypto";

const SECRET = process.env.AUTH_SECRET || "change-this-secret";

export interface AccessTokenPayload {
  sub?: string;

  provider: string;

  exp: number;

  features?: string[];

  maxQuality?: string;

  allowTv?: boolean;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function unbase64url(input: string): string {
  input = input
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  while (input.length % 4) {
    input += "=";
  }

  return Buffer.from(input, "base64").toString("utf8");
}

function sign(data: string): string {
  return base64url(
    crypto
      .createHmac("sha256", SECRET)
      .update(data)
      .digest()
  );
}

export function generateToken(
  payload: Omit<AccessTokenPayload, "exp">,
  expiresInSeconds = 60 * 60 * 24 * 30 // 30 dias
): string {
  const finalPayload: AccessTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
  };

  const encodedPayload = base64url(
    JSON.stringify(finalPayload)
  );

  const signature = sign(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function verifyToken(
  token?: string
): AccessTokenPayload | null {
  try {
    if (!token) {
      return null;
    }

    const parts = token.split(".");

    if (parts.length !== 2) {
      return null;
    }

    const [encodedPayload, providedSignature] = parts;

    const expectedSignature = sign(encodedPayload);

    // timing-safe compare
    const valid = crypto.timingSafeEqual(
      Buffer.from(providedSignature),
      Buffer.from(expectedSignature)
    );

    if (!valid) {
      return null;
    }

    const payload: AccessTokenPayload = JSON.parse(
      unbase64url(encodedPayload)
    );

    if (!payload.exp) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);

    if (payload.exp < now) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function requireAuth(token?: string) {
  const payload = verifyToken(token);

  if (!payload) {
    throw new Error("unauthorized");
  }

  return payload;
}
