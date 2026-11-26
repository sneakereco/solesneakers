import "server-only";
import { createBuyerKey } from "./buyer-key";
import { privateTrackingSchema } from "./repository";
import { DATASET_IDS } from "../Configuration/dataset";
import { readServerAnalyticsConfig } from "../Configuration/server-config";
import { readServerConsent } from "../VisitorMeasurement/server-consent";
import { resolveConsentedIdentity } from "../VisitorMeasurement/identity";
import {
  safeSlug,
  isBuyerKey,
  type ConsentState,
  type TrackingContext,
} from "../VisitorMeasurement/contract";
import type { CheckoutTotals } from "@/lib/checkout/checkout-request";

export type ServerCheckoutContext = {
  datasetId: string;
  buyerEmail: string;
  identitySecret: string | null;
  totals: CheckoutTotals;
  tracking: TrackingContext | null;
};
export type SourceContext = {
  datasetId: string;
  buyerKey: string | null;
  totals: CheckoutTotals;
  tracking: TrackingContext | null;
};

// Read cost presence, catalog dimensions and sale prices under the reservation locks.
export function buildSourceContext(input: ServerCheckoutContext): SourceContext {
  return {
    datasetId: input.datasetId,
    buyerKey:
      input.identitySecret?.trim() && input.buyerEmail.trim()
        ? createBuyerKey({ normalizedEmail: input.buyerEmail }, input.identitySecret)
        : null,
    totals: input.totals,
    tracking: input.tracking,
  };
}

export async function validateCheckoutTracking(
  raw: unknown,
  deps: {
    consent(): Promise<ConsentState>;
    identity(): Promise<{ buyerKey: string } | null>;
  },
): Promise<TrackingContext | null> {
  const result = privateTrackingSchema.safeParse(raw);
  if (!result.success) return null;
  const link = result.data;
  if (
    [link.discovery, link.purchaseSession].some(
      (dim) => dim && Object.values(dim).some((value) => safeSlug(value) !== value),
    )
  )
    return null;
  // Consent and verified identity use optional network reads. Bound their
  // combined wait without imposing a deadline on the actual payment.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      resolve(null);
    }, 750);
  });
  async function verify() {
    const consent = await deps.consent();
    if (expired) return null;
    if (consent.choice !== "accepted" || consent.receiptId !== link.receiptId)
      return null;
    if (
      isBuyerKey(link.visitorId) &&
      (await deps.identity())?.buyerKey !== link.visitorId
    )
      return null;
    return link;
  }
  try {
    return await Promise.race([verify(), deadline]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveCheckoutSourceContext(
  buyerEmail: string,
  totals: CheckoutTotals,
  raw: unknown,
) {
  const env = process.env.NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT;
  if (env !== "staging" && env !== "production") return null;
  const config = readServerAnalyticsConfig(process.env);
  return buildSourceContext({
    datasetId: DATASET_IDS[env],
    buyerEmail,
    totals,
    identitySecret: config?.identitySecret ?? null,
    tracking: await validateCheckoutTracking(raw, {
      consent: readServerConsent,
      identity: resolveConsentedIdentity,
    }),
  });
}
