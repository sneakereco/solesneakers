import "server-only";

import { createHmac } from "node:crypto";

export function createBuyerKey(
  identity: { normalizedEmail: string },
  secret: string,
): string {
  const email = identity.normalizedEmail.trim().toLowerCase();
  if (!email || !secret.trim()) {
    throw new RangeError("Buyer identity and analytics secret are required");
  }

  return `sole-buyer:v1:${createHmac("sha256", secret).update(email, "utf8").digest("hex")}`;
}
