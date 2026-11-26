import { createHash, createHmac } from "node:crypto";
import {
  eligibilityAddressSchema,
  type ClaimSubmission,
  type EligibilityAddress,
  type ValidatedEligibility,
} from "./claim-contract";

function text(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
}
export function normalizeInstagramHandle(value: string): string {
  const handle = value.normalize("NFKC").trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(handle)) throw new Error("invalid_instagram_handle");
  return handle;
}
function unit(value: string): string {
  return text(value)
    .replace(/\b([A-Z]+)\./g, "$1")
    .replace(/^(?:APARTMENT|APT|UNIT|SUITE|STE|#)\s*#?\s*/, "")
    .trim();
}
const suffixes: Record<string, string> = {
  STREET: "ST",
  AVENUE: "AVE",
  ROAD: "RD",
  DRIVE: "DR",
  BOULEVARD: "BLVD",
  COURT: "CT",
  LANE: "LN",
  PLACE: "PL",
  TERRACE: "TER",
  CIRCLE: "CIR",
  HIGHWAY: "HWY",
  PARKWAY: "PKWY",
  NORTH: "N",
  SOUTH: "S",
  EAST: "E",
  WEST: "W",
  NORTHEAST: "NE",
  NORTHWEST: "NW",
  SOUTHEAST: "SE",
  SOUTHWEST: "SW",
};
export function canonicalAddressIdentity(input: EligibilityAddress): string {
  const address = eligibilityAddressSchema.parse({ ...input, state: text(input.state) });
  let street = text(address.line1)
    .replace(/\b([A-Z]+)\./g, "$1")
    .replace(/,/g, " ");
  const inlineUnit = street.match(
    /(?:\s+(?:APARTMENT|APT|UNIT|SUITE|STE)\s*#?\s*|\s+#\s*)([A-Z0-9][A-Z0-9 -]*)$/,
  );
  const secondary = unit(address.line2 ?? "");
  const embedded = inlineUnit ? unit(inlineUnit[1]) : "";
  if (secondary && embedded && secondary !== embedded)
    throw new Error("conflicting_address_unit");
  if (inlineUnit) street = street.slice(0, inlineUnit.index).trim();
  street = street
    .replace(/\b[A-Z]+\b/g, (word) => suffixes[word] ?? word)
    .replace(/\s+/g, " ")
    .trim();
  return JSON.stringify([
    street,
    secondary || embedded,
    text(address.city),
    text(address.state),
    address.postalCode.slice(0, 5),
    "US",
  ]);
}
function keyed(secret: string, purpose: string, values: unknown): string {
  if (secret.length < 32) throw new Error("specialty_secret_unavailable");
  return createHmac("sha256", secret)
    .update(JSON.stringify(["specialty-v1", purpose, values]))
    .digest("hex");
}
export function getIdentityKeyFingerprint(secret: string): string {
  return keyed(secret, "identity-key-id", []);
}
export function deriveEligibilityKeys(
  campaignId: string,
  handle: string,
  address: EligibilityAddress,
  secret: string,
) {
  return {
    addressKey: keyed(secret, "address", [campaignId, canonicalAddressIdentity(address)]),
    instagramKey: keyed(secret, "instagram", [
      campaignId,
      normalizeInstagramHandle(handle),
    ]),
  };
}
export function fingerprintSubmission(
  productId: string,
  identity: ValidatedEligibility,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        identity.campaignId,
        productId,
        identity.normalizationVersion,
        identity.identityKeyFingerprint,
        identity.addressKey,
        identity.instagramKey,
      ]),
    )
    .digest("hex");
}
export function fingerprintInput(
  input: Pick<ClaimSubmission, "productId" | "instagramHandle" | "address">,
  secret: string,
): string {
  return keyed(secret, "submitted-payload", [
    input.productId,
    normalizeInstagramHandle(input.instagramHandle),
    [
      input.address.line1,
      input.address.line2,
      input.address.city,
      input.address.state,
      input.address.postalCode,
      input.address.country,
    ].map(text),
  ]);
}
export function hashRecoverySecret(secret: string): string {
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error("invalid_recovery_credential");
  return createHash("sha256").update(secret).digest("hex");
}
