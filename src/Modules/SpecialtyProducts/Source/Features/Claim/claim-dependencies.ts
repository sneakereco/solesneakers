import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { env } from "@/config/env";
import { getTrustedClientIp } from "@/lib/http/client-ip";
import { verifyCheckoutBrowser } from "@/lib/security/checkout-bot";
import { getStoreAccessSettings } from "@/lib/store-access/get-store-access-settings";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { validateEligibilityAddress } from "../ValidateEligibility/address-provider";
import {
  checkSpecialtyProtection,
  readBrowserCookie,
  signBrowserCookie,
  SPECIALTY_BROWSER_COOKIE,
  SPECIALTY_BROWSER_TTL_SECONDS,
} from "../RequestProtection/claim-protection";
import { recordClaimMetric } from "../RequestProtection/claim-telemetry";
import type { ClaimDependencies } from "./claim-handler";
import { SpecialtyClaimRepository } from "./claim-repository";

const limiters = new Map<number, Ratelimit>();
function limiter(max: number): Ratelimit {
  let value = limiters.get(max);
  if (!value) {
    if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN)
      throw new Error("specialty_protection_unavailable");
    value = new Ratelimit({
      redis: new Redis({
        url: env.UPSTASH_REDIS_REST_URL,
        token: env.UPSTASH_REDIS_REST_TOKEN,
      }),
      limiter: Ratelimit.slidingWindow(max, "1 m"),
      prefix: "sole:specialty:" + env.NODE_ENV,
      timeout: 2000,
    });
    limiters.set(max, value);
  }
  return value;
}
export function createSpecialtyClaimDependencies(): ClaimDependencies {
  const client = createSupabaseAdminClient();
  const repository = new SpecialtyClaimRepository(client);
  let browserPromise: Promise<string> | undefined;
  const browser = () =>
    (browserPromise ??= (async () => {
      const jar = await cookies();
      // Separate purpose/key from eligibility so result recovery survives eligibility-key outages.
      const key = env.ADMIN_SESSION_SECRET;
      if (!key) throw new Error("specialty_browser_unavailable");
      const existing = readBrowserCookie(
        jar.get(SPECIALTY_BROWSER_COOKIE)?.value,
        Date.now(),
        key,
      );
      if (existing) return existing;
      const id = randomUUID();
      jar.set(SPECIALTY_BROWSER_COOKIE, signBrowserCookie(id, Date.now(), key), {
        httpOnly: true,
        sameSite: "strict",
        secure: new URL(env.NEXT_PUBLIC_SITE_URL).protocol === "https:",
        path: "/api/specialty",
        maxAge: SPECIALTY_BROWSER_TTL_SECONDS,
      });
      return id;
    })());
  return {
    secret: () => env.SPECIALTY_CLAIMS_SECRET ?? null,
    nowMs: Date.now,
    getContext: async (_request, productId) => {
      const { data: config, error } = await client
        .from("specialty_product_config")
        .select("campaign_id")
        .eq("product_id", productId)
        .maybeSingle();
      if (error) throw new Error("specialty_context_unavailable");
      if (!config) return null;
      const { data: campaign, error: campaignError } = await client
        .from("specialty_campaigns")
        .select("id,normalization_version,identity_key_fingerprint")
        .eq("id", config.campaign_id)
        .eq("slug", env.SPECIALTY_CAMPAIGN_SLUG)
        .maybeSingle();
      if (campaignError) throw new Error("specialty_context_unavailable");
      if (!campaign || campaign.normalization_version !== 1) return null;
      return {
        campaignId: campaign.id,
        productId,
        browserId: await browser(),
        normalizationVersion: 1,
        identityKeyFingerprint: campaign.identity_key_fingerprint,
      };
    },
    protect: async (request, operation, browserId) =>
      checkSpecialtyProtection(request, operation, browserId || (await browser()), {
        siteOrigin: env.NEXT_PUBLIC_SITE_URL,
        key: env.ADMIN_SESSION_SECRET,
        getIp: (input) =>
          getTrustedClientIp({
            headers: input.headers,
            nextUrl: new URL(input.url),
          } as NextRequest),
        storeOpen: async () => {
          const access = await getStoreAccessSettings();
          return Boolean(access && !access.isSiteLocked);
        },
        verifyBrowser: verifyCheckoutBrowser,
        limit: async (key, max) => {
          const result = await limiter(max).limit(key);
          // Upstash's timeout fallback allows requests; specialty awards must fail closed.
          if (result.reason === "timeout")
            throw new Error("specialty_protection_unavailable");
          return result;
        },
      }),
    validateAddress: (address) =>
      validateEligibilityAddress(address, {
        token: env.SHIPPO_API_TOKEN,
        fetcher: fetch,
      }),
    findAttempt: (credentials) => repository.findAttempt(credentials),
    accept: (command) => repository.accept(command),
    recordMetric: recordClaimMetric,
  };
}
