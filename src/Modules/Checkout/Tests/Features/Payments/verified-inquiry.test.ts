import { SquareFinancialInquiry } from "../../../Source/Features/Payments/square-financial-inquiry";
import { verifyPaymentInquiry } from "@/lib/square/verified-inquiry";
const orderId = "00989365-3f2f-4248-9f6e-f850482fbf46",
  attemptId = "01fff41a-5789-4017-8a94-349c342a36b1";
const proof = {
  merchantId: "m",
  locationId: "l",
  merchantLocation: { id: "l", merchantId: "m" },
  local: {
    id: orderId,
    square_order_id: "sq",
    checkout_attempt_guarded: true,
    payment_transaction_id: null,
    fulfillment_status: "shipped",
  },
  attempt: {
    id: attemptId,
    order_id: orderId,
    square_order_id: "sq",
    amount_cents: 1000,
    currency: "USD",
    provider_payment_id: null,
    method: "card",
    dispatched_at: "2026-11-25T10:00:00Z",
  },
  order: {
    id: "sq",
    referenceId: orderId,
    locationId: "l",
    totalMoney: { currency: "USD", amount: 1000n },
  },
  payment: {
    id: "pay",
    orderId: "sq",
    referenceId: attemptId,
    locationId: "l",
    sourceType: "CARD",
    createdAt: "2026-11-25T10:00:00Z",
    status: "COMPLETED",
    versionToken: "opaque",
    amountMoney: { amount: 1000n, currency: "USD" },
  },
} as const;
it("binds the projected total and fulfillment to the server and exact submitted sequence", () => {
  expect(verifyPaymentInquiry(proof).fact).toMatchObject({
    providerId: "pay",
    expectedTotalCents: 1000,
    fulfillmentStatus: "shipped",
  });
});
it.each([
  { referenceId: "another" },
  { orderId: "other" },
  { locationId: "other" },
  { amountMoney: { currency: "EUR", amount: 1000n } },
  { amountMoney: { currency: "USD", amount: 1100n } },
])("keeps an uncorrelated provider observation in inquiry", (changes) => {
  expect(() =>
    verifyPaymentInquiry({
      ...proof,
      payment: { ...proof.payment, ...changes },
    } as typeof proof),
  ).toThrow();
});
it("allows an already bound legacy payment without a new local dispatch", () => {
  const known = {
    ...proof,
    local: {
      ...proof.local,
      checkout_attempt_guarded: false,
      payment_transaction_id: "pay",
    },
    attempt: { ...proof.attempt, provider_payment_id: "pay", dispatched_at: null },
    payment: { ...proof.payment, referenceId: orderId },
  };
  expect(verifyPaymentInquiry(known).fact.amountCents).toBe(1000);
  expect(() =>
    verifyPaymentInquiry({
      ...known,
      attempt: { ...known.attempt, provider_payment_id: null },
    }),
  ).toThrow();
});
it.each([
  "payment.updated",
  "dispute.created",
  "refund.updated",
  "conflicting refund",
  "same version FAILED",
  "same version REJECTED",
])(
  "replays the stored %s effects against authenticated provider reads",
  async (scenario) => {
    const collisionStatus = scenario.startsWith("same version ")
      ? scenario.slice("same version ".length)
      : null;
    const conflict = scenario === "conflicting refund" || collisionStatus !== null;
    const kind = conflict ? "refund.updated" : scenario;
    const receipt = {
      square_event_id: "evt",
      event_type: kind,
      payload_sha256: "a".repeat(64),
      recovery_receipt: true,
      processed_at: null as string | null,
      event_data: {
        merchantId: "m",
        locationId: "l",
        paymentId: "pay",
        squareOrderId: kind.startsWith("refund") ? "old-receipt-return-order" : "sq",
        createdAt: "2026-11-25T10:00:00Z",
        ...(kind.startsWith("dispute") ? { disputeId: "d" } : {}),
        ...(kind.startsWith("refund") ? { refundId: "r" } : {}),
      },
    };
    const applied = new Set<string>(),
      commands: string[] = [];
    const db = {
      from: (table: string) => {
        const row =
          table === "square_refunds"
            ? { checkout_status_conflict: conflict, amount_cents: 400 }
            : table === "orders"
              ? proof.local
              : table === "square_webhook_events"
                ? receipt
                : proof.attempt;
        let writing = false;
        const q = {
          select: () => q,
          eq: () => q,
          update: () => {
            writing = true;
            return q;
          },
          is: () => {
            if (writing) receipt.processed_at = "done";
            return { error: null };
          },
          single: () => ({ data: row, error: null }),
          maybeSingle: () => ({ data: row, error: null }),
        };
        return q;
      },
      rpc: (name: string, args: { p_fact?: { kind: string } }) => {
        commands.push(name);
        if (name === "record_checkout_payment_outcome")
          return {
            data: {
              id: attemptId,
              orderId,
              sequence: 1,
              state: "succeeded",
              method: "card",
              amountCents: 1000,
              currency: "USD",
              squareIdempotencyKey: attemptId,
              requestDigest: "b".repeat(64),
              providerPaymentId: "pay",
            },
            error: null,
          };
        if (name === "apply_checkout_financial_fact") {
          applied.add(args.p_fact!.kind);
          return {
            data: {
              orderId,
              revision: "1",
              financialState: "paid",
              capturedCents: 1000,
              refundedCents: 0,
              fulfillmentStatus: "shipped",
              reviewReason: null,
            },
            error: null,
          };
        }
        if (name === "apply_checkout_dispute_receipt") receipt.processed_at = "done";
        return { data: null, error: null };
      },
    };
    let refundReads = 0;
    const sdk = {
      payments: { get: () => Promise.resolve({ payment: proof.payment }) },
      orders: { get: () => Promise.resolve({ order: proof.order }) },
      locations: { get: () => Promise.resolve({ location: proof.merchantLocation }) },
      refunds: {
        get: () => {
          refundReads++;
          if (scenario === "conflicting refund" && refundReads === 2)
            return Promise.reject(new Error("fixture timeout"));
          return Promise.resolve({
            refund: {
              id: "r",
              orderId: "return-order",
              paymentId: "pay",
              locationId: "l",
              amountMoney: { currency: "USD", amount: 400n },
              updatedAt: "2026-11-25T11:00:00Z",
              status:
                collisionStatus && refundReads <= 4
                  ? collisionStatus
                  : conflict && refundReads === 4
                    ? "FAILED"
                    : "COMPLETED",
            },
          });
        },
      },
      disputes: {
        get: () =>
          Promise.resolve({
            dispute: {
              id: "d",
              locationId: "l",
              disputedPayment: { paymentId: "pay" },
              amountMoney: { currency: "USD", amount: 400n },
              updatedAt: "2026-11-25T11:00:00Z",
              state: "WON",
              reason: "FRAUD",
            },
          }),
      },
    };
    const syncShipping = jest
      .fn()
      .mockRejectedValueOnce(new Error("temporary lookup failure"))
      .mockResolvedValue("synced");
    const consumer = new SquareFinancialInquiry(
      db as never,
      sdk as never,
      { merchantId: "m", locationId: "l" },
      { syncShipping, scheduleNotifications: jest.fn() },
    );
    if (kind === "payment.updated") {
      await expect(consumer.processStoredSquareEvent("evt")).rejects.toThrow(
        "square_receipt_processing_pending",
      );
      expect(receipt.processed_at).toBeNull();
      expect(applied.has("payment")).toBe(true);
    }
    if (conflict) {
      for (const expectedReads of [2, 4]) {
        await expect(consumer.processStoredSquareEvent("evt")).rejects.toThrow(
          "square_receipt_processing_pending",
        );
        expect(refundReads).toBe(expectedReads);
        expect(receipt.processed_at).toBeNull();
      }
    }
    await consumer.processStoredSquareEvent("evt");
    if (conflict) expect(refundReads).toBe(6);
    expect(receipt.processed_at).toBe("done");
    if (kind === "payment.updated") expect(syncShipping).toHaveBeenCalledTimes(2);
    if (kind === "refund.updated") expect(applied.has("refund")).toBe(true);
    if (kind === "dispute.created")
      expect(commands).toContain("apply_checkout_dispute_receipt");
    const count = commands.length;
    await consumer.processStoredSquareEvent("evt");
    expect(commands).toHaveLength(count);
  },
);
