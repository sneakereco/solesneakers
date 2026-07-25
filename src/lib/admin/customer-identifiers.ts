import crypto from "node:crypto";

export type CustomerIdentity =
  | { kind: "account"; userId: string }
  | { kind: "guest"; email: string };

export function normalizeCustomerEmail(email: string) {
  return email.trim().toLowerCase();
}

export function buildCustomerDisplayId(identity: CustomerIdentity) {
  if (identity.kind === "account") {
    return `ACC-${identity.userId.slice(0, 8).toUpperCase()}`;
  }

  const digest = crypto
    .createHash("sha256")
    .update(normalizeCustomerEmail(identity.email))
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();

  return `GST-${digest}`;
}
