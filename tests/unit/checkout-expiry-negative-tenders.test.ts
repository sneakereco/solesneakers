import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import { createCheckoutRecoveryDependencies } from "@/lib/checkout/expire-checkout-reservations";
import { createSquareClient } from "@/lib/square/client";

jest.mock("@/lib/square/client", () => ({ createSquareClient: jest.fn() }));
jest.mock("@/lib/square/config", () => ({
  getSquareConfig: () => ({ locationId: "location" }),
  getSquareMerchantId: () => "merchant",
}));
jest.mock("@/lib/square/financial-inquiry-dependencies", () => ({
  createSquareFinancialInquiry: jest.fn(),
}));

function fixture(status = "FAILED", extraTender = false, conflictingCapture = false) {
  const open = {
    id: "square-order",
    referenceId: "local-order",
    locationId: "location",
    state: "OPEN",
    version: 2,
    tenders: [{ paymentId: "failed-payment" }],
  };
  const get = jest
    .fn()
    .mockResolvedValueOnce({ order: open })
    .mockResolvedValueOnce({
      order: {
        ...open,
        tenders: extraTender
          ? [...open.tenders, { paymentId: "unknown-payment" }]
          : open.tenders,
      },
    })
    .mockResolvedValue({ order: { ...open, state: "CANCELED", version: 3 } });
  const update = jest
    .fn()
    .mockResolvedValue({ order: { ...open, state: "CANCELED", version: 3 } });
  jest.mocked(createSquareClient).mockReturnValue({
    orders: { get, update },
    locations: {
      get: jest
        .fn()
        .mockResolvedValue({ location: { id: "location", merchantId: "merchant" } }),
    },
  } as unknown as ReturnType<typeof createSquareClient>);
  const rpc = jest.fn((name: string) =>
    Promise.resolve({
      data:
        name === "mark_checkout_expiry"
          ? { kind: "inquire", squareOrderId: "square-order", unknownKeys: [] }
          : "released",
      error: null,
    }),
  );
  const from = jest.fn((table: string) => {
    const result = {
      data:
        table === "checkout_financial_facts"
          ? [
              { payment_id: "failed-payment", status },
              ...(conflictingCapture
                ? [{ payment_id: "failed-payment", status: "COMPLETED" }]
                : []),
            ]
          : [],
      error: null,
    };
    const query = {
      select: () => query,
      eq: () => query,
      not: () => query,
      order: () => Promise.resolve(result),
      then: (resolve: (value: typeof result) => unknown) =>
        Promise.resolve(result).then(resolve),
    };
    return query;
  });
  const process = () =>
    createCheckoutRecoveryDependencies({
      rpc,
      from,
    } as unknown as AdminSupabaseClient).process(
      {
        id: "job",
        orderId: "local-order",
        kind: "expire_reservation",
        eventId: null,
        leaseToken: "lease",
        attempts: 1,
        unresolvedObservations: 0,
      },
      AbortSignal.timeout(10000),
    );
  return { process, rpc, update };
}

afterEach(() => jest.clearAllMocks());

it("retains stock when negative tender evidence also has a completed capture", async () => {
  const f = fixture("FAILED", false, true);
  await f.process();
  expect(f.update).not.toHaveBeenCalled();
  expect(f.rpc).toHaveBeenCalledWith("finish_checkout_expiry", {
    p_order_id: "local-order",
  });
});

it.each(["FAILED", "CANCELED"])(
  "expires an order whose retained tender is independently confirmed %s",
  async (status) => {
    const f = fixture(status);
    await expect(f.process()).resolves.toBe("done");
    expect(f.update).toHaveBeenCalledWith(
      expect.objectContaining({ order: expect.objectContaining({ state: "CANCELED" }) }),
    );
    expect(f.rpc).toHaveBeenCalledWith("finish_checkout_expiry", {
      p_order_id: "local-order",
      p_canceled_square_order_id: "square-order",
    });
  },
);

it.each(["COMPLETED", "APPROVED", "PENDING"])(
  "preserves a tender lacking negative proof (%s)",
  async (status) => {
    const f = fixture(status);
    await f.process();
    expect(f.update).not.toHaveBeenCalled();
    expect(f.rpc).toHaveBeenCalledWith("finish_checkout_expiry", {
      p_order_id: "local-order",
    });
  },
);

it("refuses cancellation if the gateway's fresh read adds an unverified tender", async () => {
  const f = fixture("FAILED", true);
  await expect(f.process()).rejects.toThrow("square_checkout_order_not_cancelable");
  expect(f.update).not.toHaveBeenCalled();
  expect(f.rpc).not.toHaveBeenCalledWith("finish_checkout_expiry", expect.anything());
});
