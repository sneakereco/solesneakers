// src/lib/crypto.ts (NEW)

import crypto from "crypto";

export function generateOrderAccessToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(token).digest("hex");
}
