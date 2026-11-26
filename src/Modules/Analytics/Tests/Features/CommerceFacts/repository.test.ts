import { analyticsFactSchema } from "../../../Source/Features/CommerceFacts/contract";
import { createFactRepository } from "../../../Source/Features/CommerceFacts/repository";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import { base, id, payloads } from "./fixtures";

jest.mock("server-only", () => ({}), { virtual: true });
const fact = analyticsFactSchema.parse({ ...base, payload: payloads.order });
it("validates facts before the atomic append RPC", async () => {
  const rpc = jest.fn().mockResolvedValue({ data: id, error: null });
  const repo = createFactRepository({ rpc } as unknown as AdminSupabaseClient);
  const badFact = { ...fact, raw: "sensitive" };
  await expect(repo.appendFact(badFact)).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
  await expect(repo.appendFact(fact)).resolves.toBe(id);
  expect(rpc).toHaveBeenCalledWith("analytics_append_fact", { p_fact: fact });
});
it("reads a confirmed sale anchor before permitting a tracked purchase", async () => {
  const filters = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
  const db = { from: jest.fn().mockReturnValue(filters) };
  const repo = createFactRepository(db as never);
  expect(await repo.getActivePurchaseContext("sole-staging", id)).toBeNull();
  expect(db.from).toHaveBeenCalledWith("analytics_fact_versions");
  expect(db.from).not.toHaveBeenCalledWith("analytics_order_context");
  filters.maybeSingle.mockResolvedValueOnce({
    data: { effective_at: "2026-11-25T00:00:00Z" },
    error: null,
  });
  await repo.getActivePurchaseContext("sole-staging", id);
  expect(filters.lte).toHaveBeenCalledWith(
    "analytics_consent_receipts.granted_at",
    "2026-11-25T00:00:00Z",
  );
});
it("supports a consented SDK distinct id and rejects raw visitor identifiers", async () => {
  const { privateTrackingSchema } = await import(
    "../../../Source/Features/CommerceFacts/repository"
  );
  const tracking = {
    receiptId: id,
    sessionId: id,
    visitorId: id,
    device: "unknown",
    discovery: null,
    purchaseSession: null,
  };
  expect(privateTrackingSchema.safeParse(tracking).success).toBe(true);
  expect(
    privateTrackingSchema.safeParse({
      ...tracking,
      visitorId: "sole-buyer:v1:" + "a".repeat(64),
    }).success,
  ).toBe(true);
  expect(
    privateTrackingSchema.safeParse({ ...tracking, visitorId: "buyer@example.com" })
      .success,
  ).toBe(false);
});
