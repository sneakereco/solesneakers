import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import { CheckoutRecoveryRepository } from "@/Modules/Checkout/Source/Features/Recovery/recovery-repository";
import { CheckoutDependencyLeaseRepository } from "@/Modules/Checkout/Source/Features/Recovery/dependency-lease";
import {
  SquareWebhookInbox,
  type SquareEventReceiptInput,
} from "@/Modules/Checkout/Source/Features/Payments/webhook-inbox";

const orderId = "5ad5a918-8420-4690-8d11-e8efac35eed2";
const jobId = "a92d7b37-3520-4a92-ac88-46d5e6571d8f";
const token = "5c35a09e-f4ec-44e1-9644-10678328063a";
const eventId = "fixture-event";
const now = "2026-11-25T12:00:00.000Z";
const job = {
  id: jobId,
  kind: "expire_reservation",
  orderId,
  eventId: null,
  leaseToken: token,
  attempts: 1,
  unresolvedObservations: 0,
};
const receipt = {
  eventId,
  kind: "payment.updated",
  payloadHash: "a".repeat(64),
  payload: {
    merchantId: "merchant-fixture",
    locationId: "location-fixture",
    createdAt: now,
    paymentId: "payment-fixture",
  },
} satisfies SquareEventReceiptInput;

function database() {
  const rpc = jest.fn<Promise<{ data: unknown; error: unknown }>, [string, unknown?]>();
  return { rpc, client: { rpc: rpc as unknown as AdminSupabaseClient["rpc"] } };
}

test("enqueues a scrubbed reference through the trusted RPC and preserves database failures", async () => {
  const { rpc, client } = database();
  const repository = new CheckoutRecoveryRepository(client);
  rpc.mockResolvedValueOnce({ data: null, error: null });
  await expect(
    repository.enqueueRecovery({
      uniqueKey: "square_event:" + eventId,
      dueAt: now,
      reason: null,
      kind: "square_event",
      eventId,
    }),
  ).resolves.toBeUndefined();
  expect(rpc).toHaveBeenCalledWith("enqueue_checkout_recovery", {
    p_unique_key: "square_event:" + eventId,
    p_due_at: now,
    p_kind: "square_event",
    p_event_id: eventId,
  });
  const failure = { code: "08006", message: "synthetic database error" };
  rpc.mockResolvedValueOnce({ data: null, error: failure });
  await expect(
    repository.enqueueRecovery({
      uniqueKey: "expire_reservation:" + orderId,
      dueAt: now,
      kind: "expire_reservation",
      orderId,
      reason: "reservation_expiring",
    }),
  ).rejects.toBe(failure);
  expect(rpc).toHaveBeenLastCalledWith("enqueue_checkout_recovery", {
    p_unique_key: "expire_reservation:" + orderId,
    p_due_at: now,
    p_kind: "expire_reservation",
    p_order_id: orderId,
    p_reason: "reservation_expiring",
  });
});

test("claims typed order and event work and preserves a stale completion result", async () => {
  const { rpc, client } = database();
  const repository = new CheckoutRecoveryRepository(client);
  const event = { ...job, kind: "square_event", orderId: null, eventId };
  rpc.mockResolvedValueOnce({ data: [job, event], error: null });
  await expect(
    repository.claimRecovery({ limit: 50, leaseSeconds: 120, now }),
  ).resolves.toEqual([job, event]);
  expect(rpc).toHaveBeenCalledWith("claim_checkout_recovery", {
    p_limit: 50,
    p_lease_seconds: 120,
    p_now: now,
  });

  rpc.mockResolvedValueOnce({ data: false, error: null });
  await expect(
    repository.finishRecovery({
      id: jobId,
      leaseToken: token,
      result: "retry",
      nextAttemptAt: now,
      reason: "provider_timeout",
    }),
  ).resolves.toBe(false);
  expect(rpc).toHaveBeenLastCalledWith("finish_checkout_recovery", {
    p_id: jobId,
    p_lease_token: token,
    p_result: "retry",
    p_next_attempt_at: now,
    p_reason: "provider_timeout",
  });
});

test.each([
  null,
  { jobs: [job] },
  [{ ...job, attempts: 0 }],
  [{ ...job, kind: "other" }],
  [{ ...job, leaseToken: "" }],
  [{ ...job, orderId: null }],
  [{ ...job, kind: "square_event", eventId }],
])("rejects malformed job JSON from the database (%#)", async (invalid) => {
  const { rpc, client } = database();
  rpc.mockResolvedValueOnce({ data: invalid, error: null });
  await expect(
    new CheckoutRecoveryRepository(client).claimRecovery({
      limit: 50,
      leaseSeconds: 120,
      now,
    }),
  ).rejects.toThrow("Invalid checkout recovery claim");
});

test("rejects malformed completion JSON and scrubbed-reason violations", async () => {
  const { rpc, client } = database();
  const repository = new CheckoutRecoveryRepository(client);
  rpc.mockResolvedValueOnce({ data: "false", error: null });
  await expect(
    repository.finishRecovery({ id: jobId, leaseToken: token, result: "done" }),
  ).rejects.toThrow("Invalid checkout recovery completion");
  await expect(
    repository.finishRecovery({
      id: jobId,
      leaseToken: token,
      result: "review",
      reason: "unstructured error from provider",
    }),
  ).rejects.toThrow("Invalid checkout recovery reason");
  expect(rpc).toHaveBeenCalledTimes(1);
});

test("acquires and releases a validated dependency lease and distinguishes exhausted capacity", async () => {
  const { rpc, client } = database();
  const leases = new CheckoutDependencyLeaseRepository(client);
  rpc.mockResolvedValueOnce({ data: token, error: null });
  await expect(
    leases.acquireDependencyLease({ dependency: "shippo", limit: 4, leaseSeconds: 120 }),
  ).resolves.toBe(token);
  expect(rpc).toHaveBeenCalledWith("acquire_checkout_dependency_lease", {
    p_dependency: "shippo",
    p_limit: 4,
    p_lease_seconds: 120,
  });
  rpc.mockResolvedValueOnce({ data: null, error: null });
  await expect(
    leases.acquireDependencyLease({ dependency: "smtp", limit: 4, leaseSeconds: 120 }),
  ).resolves.toBeNull();
  rpc.mockResolvedValueOnce({ data: { token }, error: null });
  await expect(
    leases.acquireDependencyLease({ dependency: "square", limit: 4, leaseSeconds: 120 }),
  ).rejects.toThrow("Invalid checkout dependency lease");
  rpc.mockResolvedValueOnce({ data: null, error: null });
  await expect(leases.releaseDependencyLease(token)).resolves.toBeUndefined();
  expect(rpc).toHaveBeenLastCalledWith("release_checkout_dependency_lease", {
    p_token: token,
  });
});

test("stores bounded normalized Square references and validates the receipt result", async () => {
  const { rpc, client } = database();
  const inbox = new SquareWebhookInbox(client);
  for (const status of ["stored", "duplicate"]) {
    rpc.mockResolvedValueOnce({ data: status, error: null });
    await expect(inbox.receiveSquareEvent(receipt)).resolves.toBe(status);
  }
  expect(rpc).toHaveBeenLastCalledWith("receive_checkout_square_event", {
    p_event_id: eventId,
    p_kind: receipt.kind,
    p_payload_hash: receipt.payloadHash,
    p_payload: receipt.payload,
  });
  rpc.mockResolvedValueOnce({ data: "unexpected", error: null });
  await expect(inbox.receiveSquareEvent(receipt)).rejects.toThrow(
    "Invalid Square receipt",
  );
});

test("rejects unknown and oversized fields before sending the receipt to storage", async () => {
  const { rpc, client } = database();
  const inbox = new SquareWebhookInbox(client);
  const unsafeReceipt = {
    ...receipt,
    payload: { ...receipt.payload, sourceId: "fixture-only" },
  };
  await expect(inbox.receiveSquareEvent(unsafeReceipt)).rejects.toThrow(
    "Invalid Square receipt payload",
  );
  await expect(
    inbox.receiveSquareEvent({
      ...receipt,
      payload: { ...receipt.payload, paymentId: "a".repeat(4096) },
    }),
  ).rejects.toThrow("Invalid Square receipt payload");
  expect(rpc).not.toHaveBeenCalled();
});
