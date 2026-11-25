import { factParityCases } from "../CommerceFacts/fact-parity";
import { analyticsFactSchema } from "../../../Source/Features/CommerceFacts/contract";
import { createDeliveryRepository } from "../../../Source/Features/EventDelivery/delivery-repository";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import { base, id, payloads } from "../CommerceFacts/fixtures";

jest.mock("server-only", () => ({}), { virtual: true });
const fact = analyticsFactSchema.parse({ ...base, payload: payloads.order });
it("decodes leased facts and refuses malformed queue rows", async () => {
  const rpc = jest
    .fn()
    .mockResolvedValueOnce({
      data: [
        {
          publication_id: id,
          lease_token: id,
          lease_expires_at: base.effectiveAt,
          attempt: 1,
          environment: "staging",
          fact,
        },
      ],
      error: null,
    })
    .mockResolvedValueOnce({ data: [{}], error: null });
  const repo = createDeliveryRepository(
    { rpc } as unknown as AdminSupabaseClient,
    base.datasetId,
  );
  expect((await repo.claimPublications(10, 30))[0]).toMatchObject({
    id,
    leaseToken: id,
    attempt: 1,
    fact,
  });
  await expect(repo.claimPublications(10, 30)).rejects.toThrow();
});
it("stores sanitized failures and fences completion by token", async () => {
  const rpc = jest.fn().mockResolvedValue({ data: false, error: null });
  const repo = createDeliveryRepository(
    { rpc } as unknown as AdminSupabaseClient,
    base.datasetId,
  );
  await expect(
    repo.failPublication(id, id, {
      status: "retryable",
      reason: "network",
      retryAfterMs: 2500,
    }),
  ).resolves.toBe(false);
  expect(rpc).toHaveBeenCalledWith("analytics_fail_publication", {
    p_dataset_id: base.datasetId,
    p_id: id,
    p_lease_token: id,
    p_category: "network",
    p_terminal: false,
    p_retry_after_seconds: 3,
  });
  await expect(repo.completePublication(id, id)).resolves.toBe(false);
  expect(rpc).toHaveBeenCalledWith("analytics_complete_publication", {
    p_dataset_id: base.datasetId,
    p_id: id,
    p_lease_token: id,
  });
});

it("returns healthy leases from a mixed batch and quarantines incompatible facts individually", async () => {
  const packet = factParityCases.map((entry, index) => ({
    publication_id: "fdee0191-8256-47cc-9520-" + String(index + 1).padStart(12, "0"),
    lease_token: id,
    lease_expires_at: base.effectiveAt,
    attempt: 1,
    environment: "staging",
    fact: entry.candidate,
  }));
  const rpc = jest.fn().mockImplementation((method: string) => {
    if (method === "analytics_claim_publications")
      return Promise.resolve({ data: packet, error: null });
    return Promise.resolve({ data: true, error: null });
  });
  const jobs = await createDeliveryRepository(
    { rpc } as unknown as AdminSupabaseClient,
    base.datasetId,
  ).claimPublications(100, 30);
  expect(jobs.map((job) => job.id)).toEqual(
    packet.filter((_, i) => factParityCases[i].valid).map((row) => row.publication_id),
  );
  const quarantined = rpc.mock.calls.slice(1).map((call) => call[1]);
  expect(quarantined).toEqual(
    packet
      .filter((_, i) => !factParityCases[i].valid)
      .map((row) => ({
        p_dataset_id: base.datasetId,
        p_id: row.publication_id,
        p_lease_token: id,
        p_category: "invalid-events",
        p_terminal: true,
        p_retry_after_seconds: 0,
      })),
  );
});
