import type { CheckoutAdmissionBudgets } from "../../../Source/Features/Operations/admission";
import {
  readCheckoutHealth,
  checkoutAlerts,
  alertOrderReference,
} from "../../../Source/Features/Operations/health-snapshot";
import { GET } from "@/app/api/cron/checkout-health/route";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";

jest.mock("@/lib/supabase/service-role", () => ({
  createSupabaseAdminClient: jest.fn(),
}));
jest.mock("../../../Source/Features/Operations/admission", () => ({
  checkoutAdmissionBudgets: null,
}));
const observedAt = "2026-11-26T12:00:00.000Z";
const base = {
  observedAt,
  recoveryLastSeenAt: null,
  mailLastSeenAt: observedAt,
  oldestUnknownMs: 1200000,
  oldestDueMs: 0,
  oldestOrderBoundDueMs: 0,
  expiredHoldLagMs: 0,
  oldestNotificationMs: 0,
  reviewCount: 1,
  queueDepth: 1,
  notificationDepth: 0,
  webhookLagMs: 0,
  expiredLeases: 0,
  activeConnections: 1,
  maxConnections: 100,
  waitingLocks: 0,
  oldestPendingMs: 0,
  squareLeases: 0,
  shippoLeases: 0,
  smtpLeases: 0,
  pauseNewCheckouts: false,
  pausePaymentDispatch: false,
  reviewOrderId: "20000000-0000-4000-8000-000000000002",
  alertOrderIds: { old_unknown: "20000000-0000-4000-8000-000000000003" },
};

it("a missing recovery heartbeat and a synthetic blocked review job degrade health", async () => {
  const health = await readCheckoutHealth({ read: () => Promise.resolve(base) });
  expect(health.workerLastSeenAt).toBeNull();
  expect(checkoutAlerts(health)).toEqual(
    expect.arrayContaining(["missing_heartbeat", "old_unknown", "manual_review"]),
  );
});
it("protects details and degrades invalid data or unavailable DB without healthy zeroes", async () => {
  const secret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "synthetic-local-health-check-secret-only";
  const rpc = jest.fn();
  jest.mocked(createSupabaseAdminClient).mockReturnValue({ rpc } as never);
  const request = (authenticated: boolean) =>
    new Request("https://fixture.invalid/api/cron/checkout-health", {
      headers: authenticated
        ? { authorization: "Bearer " + process.env.CRON_SECRET }
        : {},
    });
  try {
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
    const denied = await GET(request(false));
    expect(denied.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    for (const result of [
      { data: {}, error: null },
      { data: null, error: { message: "SYNTHETIC_SECRET" } },
    ]) {
      rpc.mockResolvedValueOnce(result);
      const unavailable = await GET(request(true));
      expect(unavailable.status).toBe(503);
      expect(await unavailable.json()).toEqual({
        status: "degraded",
        alerts: ["health_unavailable"],
      });
    }
    rpc.mockResolvedValueOnce({ data: base, error: null });
    const degraded = await GET(request(true));
    expect(degraded.status).toBe(503);
    expect(await degraded.json()).toMatchObject({
      alerts: expect.arrayContaining([
        "foreground_admission_unconfigured",
        "manual_review",
      ]),
      correlation: {
        reviewOrderId: base.reviewOrderId,
        alertOrderIds: {
          old_unknown: base.alertOrderIds.old_unknown,
          manual_review: base.reviewOrderId,
        },
      },
      admission: {
        foreground: "unavailable",
        recoveryProviderCaps: { square: 4, shippo: 4, smtp: 4 },
      },
    });
    expect(warning.mock.calls.map(([line]) => JSON.parse(line))).toContainEqual(
      expect.objectContaining({
        alert: "old_unknown",
        orderId: base.alertOrderIds.old_unknown,
      }),
    );
    expect(
      warning.mock.calls.some(([line]) => JSON.parse(line).alert === "manual_review"),
    ).toBe(true);
    const admission = jest.requireMock<{
      checkoutAdmissionBudgets: CheckoutAdmissionBudgets | null;
    }>("../../../Source/Features/Operations/admission");
    const configured = jest.replaceProperty(admission, "checkoutAdmissionBudgets", {
      version: 1,
      revision: "SYNTHETIC_SECRET_REV",
      ipPerMinute: 10,
      globalPerMinute: 20,
      providers: { square: 2, shippo: 3 },
    });
    try {
      rpc.mockResolvedValueOnce({
        data: {
          ...base,
          reviewCount: 0,
          reviewOrderId: null,
          oldestUnknownMs: 0,
          recoveryLastSeenAt: observedAt,
        },
        error: null,
      });
      const healthy = await GET(request(true));
      const body = await healthy.json();
      expect({ status: healthy.status, alerts: body.alerts }).toEqual({
        status: 200,
        alerts: [],
      });
      expect(body).toMatchObject({
        alerts: [],
        admission: {
          version: 1,
          configurationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          sharedProviderCaps: { square: 2, shippo: 3 },
        },
      });
      expect(JSON.stringify(body)).not.toContain("SYNTHETIC_SECRET");
    } finally {
      configured.restore();
    }
  } finally {
    jest.restoreAllMocks();
    if (secret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = secret;
  }
});

it("does not associate a young local job with an overdue unbound inbox job", async () => {
  const old = await readCheckoutHealth({
    read: () =>
      Promise.resolve({
        ...base,
        oldestDueMs: 400000,
        oldestOrderBoundDueMs: 1000,
        alertOrderIds: { overdue_recovery: base.reviewOrderId },
      }),
  });
  expect(checkoutAlerts(old)).toContain("overdue_recovery");
  expect(alertOrderReference(old, "overdue_recovery")).toBeNull();
  expect(
    alertOrderReference({ ...old, oldestOrderBoundDueMs: 350000 }, "overdue_recovery"),
  ).toBe(base.reviewOrderId);
});
