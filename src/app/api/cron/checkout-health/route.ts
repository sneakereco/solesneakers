import { createHash } from "node:crypto";
import { checkoutAdmissionBudgets } from "@/Modules/Checkout/Source/Features/Operations/admission";
import {
  readDatabaseCheckoutHealth,
  checkoutAlerts,
} from "@/Modules/Checkout/Source/Features/Operations/health-snapshot";
import { getCronSecret, isAuthorizedCronRequest } from "@/lib/http/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { log } from "@/lib/utils/log";

const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request) {
  try {
    if (!isAuthorizedCronRequest(request, getCronSecret()))
      return Response.json({ error: "Unauthorized" }, { status: 401, headers });
    const health = await readDatabaseCheckoutHealth(createSupabaseAdminClient());
    const alerts = checkoutAlerts(health);
    const budgets = checkoutAdmissionBudgets;
    if (!budgets) alerts.push("foreground_admission_unconfigured");
    for (const alert of alerts)
      log({
        alert,
        level: "warn",
        layer: "observability",
        message: "checkout_alert",
        route: "/api/cron/checkout-health",
        orderId: alert === "manual_review" ? health.reviewOrderId : undefined,
        outcome: "degraded",
      });
    const { reviewOrderId, ...metrics } = health;
    return Response.json(
      {
        status: alerts.length ? "degraded" : "healthy",
        alerts,
        metrics,
        correlation: { reviewOrderId },
        runbook: "docs/operations/checkout-hardening-runbook.md",
        admission: budgets
          ? {
              version: budgets.version,
              configurationSha256: createHash("sha256")
                .update(JSON.stringify(budgets))
                .digest("hex"),
              ipPerMinute: budgets.ipPerMinute,
              globalPerMinute: budgets.globalPerMinute,
              sharedProviderCaps: budgets.providers,
              smtpCap: 4,
            }
          : {
              version: null,
              foreground: "unavailable",
              recoveryProviderCaps: { square: 4, shippo: 4, smtp: 4 },
            },
      },
      { status: alerts.length ? 503 : 200, headers },
    );
  } catch {
    log({
      level: "warn",
      layer: "observability",
      message: "checkout_alert",
      alert: "health_unavailable",
      outcome: "degraded",
      route: "/api/cron/checkout-health",
    });
    return Response.json(
      { status: "degraded", alerts: ["health_unavailable"] },
      { status: 503, headers },
    );
  }
}
