import "server-only";
import { createHmac } from "node:crypto";
import { AuthService } from "@/services/auth-service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createBuyerKey } from "../CommerceFacts/buyer-key";
import { readServerAnalyticsConfig } from "../Configuration/server-config";
import { readServerConsent } from "./server-consent";

export async function resolveConsentedIdentity(): Promise<{ buyerKey: string } | null> {
  if ((await readServerConsent()).choice !== "accepted") return null;
  const config = readServerAnalyticsConfig(process.env);
  if (!config) return null;
  const { user, profile } = await new AuthService(
    await createSupabaseServerClient(),
  ).getCurrentUserProfile({ requireAvailable: true });
  if (!user?.email_confirmed_at || !user.email || profile?.role !== "customer")
    return null;
  // Keep the existing opaque wire format with a separate HMAC key for behavior.
  const visitorSecret = createHmac("sha256", config.identitySecret)
    .update("sole:consented-visitor:v1", "utf8")
    .digest("hex");
  return {
    buyerKey: createBuyerKey({ normalizedEmail: user.email }, visitorSecret),
  };
}
