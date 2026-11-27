import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import {
  CheckoutPaymentAttemptRepository,
  readCurrentPaymentAttempt,
} from "@/Modules/Checkout/Source/Features/Payments/attempt-repository";

const id = "c40e0e93-c290-464d-9660-a68d4e6ef881",
  orderId = "24734160-4ab6-4502-8f50-51ef7f69bcab";
const ownerBinding = "account:" + orderId,
  requestDigest = "a".repeat(64),
  sourceDigest = "b".repeat(64);
const a = {
  id,
  orderId,
  sequence: 1,
  state: "ready",
  method: "card",
  amountCents: 1250,
  currency: "USD",
  squareIdempotencyKey: id,
  requestDigest: null,
  providerPaymentId: null,
};
function setup() {
  const rpc = jest.fn<Promise<{ data: unknown; error: unknown }>, [string, unknown?]>();
  return {
    rpc,
    repo: new CheckoutPaymentAttemptRepository({
      rpc: rpc as unknown as AdminSupabaseClient["rpc"],
    }),
  };
}
test("returns the durable DTO and dispatch decision, preserving the SQL error on save", async () => {
  const { rpc, repo } = setup();
  rpc.mockResolvedValueOnce({ data: a, error: null });
  await expect(
    repo.getOrCreateAttempt({ orderId, method: "card", ownerBinding }),
  ).resolves.toEqual(a);
  const claimed = {
    kind: "dispatch",
    attempt: { ...a, state: "dispatch_started", requestDigest },
  };
  rpc.mockResolvedValueOnce({ data: claimed, error: null });
  await expect(
    repo.beginDispatch({ attemptId: id, ownerBinding, requestDigest, sourceDigest }),
  ).resolves.toEqual(claimed);
  expect(rpc).toHaveBeenLastCalledWith("begin_checkout_payment_dispatch", {
    p_attempt_id: id,
    p_owner_binding: ownerBinding,
    p_request_digest: requestDigest,
    p_source_digest: sourceDigest,
  });
  const error = { code: "08006" };
  rpc.mockResolvedValueOnce({ data: null, error });
  await expect(
    repo.recordAttemptOutcome({
      attemptId: id,
      providerPaymentId: null,
      state: "unknown",
      verifiedFacts: { kind: "uncertain", reason: "response_lost" },
    }),
  ).rejects.toBe(error);
});
test("reads the verified legacy outcome with its original unknown dispatch fingerprint", async () => {
  const { repo, rpc } = setup();
  const providerPaymentId = "legacy-payment";
  const result = { ...a, state: "succeeded", providerPaymentId };
  rpc.mockResolvedValueOnce({ data: result, error: null });
  await expect(
    repo.recordAttemptOutcome({
      attemptId: id,
      providerPaymentId,
      state: "succeeded",
      verifiedFacts: {
        kind: "square_payment",
        orderId,
        squareOrderId: "legacy-square-order",
        paymentId: providerPaymentId,
        amountCents: 1250,
        currency: "USD",
        status: "COMPLETED",
      },
    }),
  ).resolves.toEqual(result);
  rpc.mockResolvedValueOnce({ data: { kind: "observe", attempt: result }, error: null });
  await expect(
    repo.beginDispatch({ attemptId: id, ownerBinding, requestDigest, sourceDigest }),
  ).resolves.toEqual({ kind: "observe", attempt: result });
});

test("rejects unexpected or credential-shaped inputs before persisting any facts", async () => {
  const { repo, rpc } = setup();
  await expect(
    repo.beginDispatch({
      attemptId: id,
      ownerBinding,
      requestDigest,
      sourceDigest: "raw-fixture",
    }),
  ).rejects.toThrow();
  await expect(
    repo.getOrCreateAttempt({ orderId, method: "card", ownerBinding: orderId }),
  ).rejects.toThrow();
  const facts = {
    kind: "uncertain" as const,
    reason: "response_lost" as const,
    sourceId: "fixture",
  };
  await expect(
    repo.recordAttemptOutcome({
      attemptId: id,
      providerPaymentId: null,
      state: "unknown",
      verifiedFacts: facts,
    }),
  ).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
});
test("invalid dispatch decisions and malformed rows fail closed", async () => {
  const { repo, rpc } = setup();
  rpc.mockResolvedValueOnce({ data: { kind: "dispatch", attempt: a }, error: null });
  await expect(
    repo.beginDispatch({ attemptId: id, ownerBinding, requestDigest, sourceDigest }),
  ).rejects.toThrow();
  rpc.mockResolvedValueOnce({
    data: {
      kind: "dispatch",
      attempt: {
        ...a,
        state: "dispatch_started",
        requestDigest,
        providerPaymentId: "existing-payment",
      },
    },
    error: null,
  });
  await expect(
    repo.beginDispatch({ attemptId: id, ownerBinding, requestDigest, sourceDigest }),
  ).rejects.toThrow();
  for (const invalid of [
    { ...a, amountCents: 1.5 },
    { ...a, currency: "CAD" },
    { ...a, squareIdempotencyKey: "x".repeat(46) },
    { ...a, sourceDigest },
  ]) {
    rpc.mockResolvedValueOnce({ data: invalid, error: null });
    await expect(
      repo.getOrCreateAttempt({ orderId, method: "card", ownerBinding }),
    ).rejects.toThrow();
  }
});

test("checks the returned proof state and payment identity while retaining pending on uncertainty", async () => {
  const { rpc, repo } = setup();
  const proof = {
    attemptId: id,
    providerPaymentId: "p1",
    state: "pending" as const,
    verifiedFacts: {
      kind: "square_payment" as const,
      orderId,
      squareOrderId: "sq",
      paymentId: "p1",
      amountCents: 1250,
      currency: "USD" as const,
      status: "APPROVED" as const,
    },
  };
  const pending = { ...a, state: "pending", providerPaymentId: "p1", requestDigest };
  for (const invalid of [
    { ...pending, providerPaymentId: null },
    { ...pending, providerPaymentId: "p2" },
    { ...pending, state: "succeeded" },
  ]) {
    rpc.mockResolvedValueOnce({ data: invalid, error: null });
    await expect(repo.recordAttemptOutcome(proof)).rejects.toThrow(
      "Invalid checkout outcome response",
    );
  }
  rpc.mockResolvedValueOnce({ data: pending, error: null });
  await expect(
    repo.recordAttemptOutcome({
      attemptId: id,
      providerPaymentId: null,
      state: "unknown",
      verifiedFacts: { kind: "uncertain", reason: "provider_timeout" },
    }),
  ).resolves.toEqual(pending);
});

test("the observation reader selects the latest sequence and rejects another order's row", async () => {
  const maybeSingle = jest
    .fn()
    .mockResolvedValueOnce({ data: a, error: null })
    .mockResolvedValueOnce({ data: { ...a, orderId: id }, error: null })
    .mockResolvedValueOnce({ data: null, error: null });
  const limit = jest.fn(() => ({ maybeSingle })),
    order = jest.fn(() => ({ limit })),
    eq = jest.fn(() => ({ order })),
    select = jest.fn(() => ({ eq }));
  const from = jest.fn(() => ({ select }));
  const client = { from: from as unknown as AdminSupabaseClient["from"] };
  await expect(readCurrentPaymentAttempt(client, orderId)).resolves.toEqual(a);
  expect(eq).toHaveBeenCalledWith("order_id", orderId);
  expect(order).toHaveBeenCalledWith("sequence", { ascending: false });
  expect(limit).toHaveBeenCalledWith(1);
  await expect(readCurrentPaymentAttempt(client, orderId)).rejects.toThrow(
    "Invalid checkout attempt response",
  );
  await expect(readCurrentPaymentAttempt(client, orderId)).resolves.toBeNull();
});
