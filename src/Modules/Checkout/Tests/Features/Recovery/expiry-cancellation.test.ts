import { createCheckoutRecoveryDependencies } from "@/lib/checkout/expire-checkout-reservations";
import { createSquareClient } from "@/lib/square/client";
import { createSquareFinancialInquiry } from "@/lib/square/financial-inquiry-dependencies";

jest.mock("@/lib/square/client", () => ({ createSquareClient: jest.fn() }));
jest.mock("@/lib/square/financial-inquiry-dependencies", () => ({
  createSquareFinancialInquiry: jest.fn(),
}));
jest.mock("@/lib/square/config", () => ({
  getSquareConfig: () => ({ locationId: "location" }),
  getSquareMerchantId: () => "merchant",
}));

const orderId = "11111111-1111-4111-8111-111111111111";
const squareId = "square-order";
function fixture(
  facts: Array<{ payment_id: string; status: string }>,
  gatewayAddsTender = false,
) {
  let canceled = false;
  let reads = 0;
  const get = jest.fn(() => {
    reads++;
    return Promise.resolve({
      order: {
        id: squareId,
        referenceId: orderId,
        locationId: "location",
        state: canceled ? "CANCELED" : "OPEN",
        version: canceled ? 3 : 2,
        tenders: [
          { paymentId: "failed-payment" },
          ...(gatewayAddsTender && reads > 1 ? [{ paymentId: "unknown-payment" }] : []),
        ],
      },
    });
  });
  const update = jest.fn(() => {
    canceled = true;
    return Promise.resolve({ order: { id: squareId, state: "CANCELED", version: 3 } });
  });
  jest.mocked(createSquareClient).mockReturnValue({
    orders: { get, update },
    locations: {
      get: () =>
        Promise.resolve({ location: { id: "location", merchantId: "merchant" } }),
    },
  } as unknown as ReturnType<typeof createSquareClient>);
  const recoverAttempt = jest.fn(() => Promise.resolve("done" as const));
  jest
    .mocked(createSquareFinancialInquiry)
    .mockReturnValue({ recoverAttempt } as unknown as ReturnType<
      typeof createSquareFinancialInquiry
    >);
  const rpc = jest.fn((name: string, args?: Record<string, unknown>) =>
    Promise.resolve({
      error: null,
      data:
        name === "mark_checkout_expiry"
          ? { kind: "inquire", squareOrderId: squareId, unknownKeys: [] }
          : args?.p_canceled_square_order_id === squareId
            ? "released"
            : "reconcile",
    }),
  );
  const db = {
    rpc,
    from(table: string) {
      expect(["checkout_payment_attempts", "checkout_financial_facts"]).toContain(table);
      const data = table === "checkout_payment_attempts" ? [{ id: "attempt" }] : facts;
      const result = { data, error: null };
      const q = {
        select: () => q,
        eq: () => q,
        not: () => q,
        order: () => Promise.resolve(result),
        then: (resolve: (value: typeof result) => unknown) =>
          Promise.resolve(result).then(resolve),
      };
      return q;
    },
  };
  const worker = createCheckoutRecoveryDependencies(
    db as unknown as Parameters<typeof createCheckoutRecoveryDependencies>[0],
  );
  const run = () =>
    worker.process(
      {
        id: "job",
        kind: "expire_reservation",
        orderId,
        eventId: null,
        leaseToken: "lease",
        attempts: 1,
        unresolvedObservations: 0,
      },
      AbortSignal.timeout(1000),
    );
  return { run, rpc, get, update, recoverAttempt };
}

it("cancels an OPEN order with an independently verified FAILED tender before offering release proof", async () => {
  const f = fixture([{ payment_id: "failed-payment", status: "FAILED" }]);
  await expect(f.run()).resolves.toBe("done");
  expect(f.recoverAttempt).toHaveBeenCalledWith(orderId, "attempt", true);
  expect(f.update).toHaveBeenCalledTimes(1);
  expect(f.get).toHaveBeenCalledTimes(3);
  expect(f.rpc).toHaveBeenLastCalledWith("finish_checkout_expiry", {
    p_order_id: orderId,
    p_canceled_square_order_id: squareId,
  });
});

it.each(
  [
    [],
    [{ payment_id: "other-payment", status: "FAILED" }],
    [{ payment_id: "failed-payment", status: "PENDING" }],
    [
      { payment_id: "failed-payment", status: "FAILED" },
      { payment_id: "failed-payment", status: "COMPLETED" },
    ],
  ].map((facts) => ({ facts })),
)(
  "retains the hold when negative tender evidence is absent or contradicted: %j",
  async ({ facts }) => {
    const f = fixture(facts);
    await expect(f.run()).resolves.toBe("retry");
    expect(f.update).not.toHaveBeenCalled();
    expect(f.rpc).toHaveBeenLastCalledWith("finish_checkout_expiry", {
      p_order_id: orderId,
    });
  },
);

it("refuses a new unverified tender found by the gateway's fresh read", async () => {
  const f = fixture([{ payment_id: "failed-payment", status: "FAILED" }], true);
  await expect(f.run()).rejects.toThrow("square_checkout_order_not_cancelable");
  expect(f.update).not.toHaveBeenCalled();
  expect(f.rpc).toHaveBeenCalledTimes(1);
});
