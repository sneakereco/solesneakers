import { NextRequest } from "next/server";
import { GET } from "@/app/api/orders/[orderId]/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
jest.mock("@/lib/supabase/server");
jest.mock("@/lib/supabase/service-role");
jest.mock("@/lib/utils/log");
const orderId = "10000000-0000-4000-8000-000000000001";
const product = "20000000-0000-4000-8000-000000000001";
const variant = "30000000-0000-4000-8000-000000000001";
const item = {
  id: "40000000-0000-4000-8000-000000000001",
  order_id: orderId,
  product_id: product,
  variant_id: variant,
  quantity: 2,
};
const order = {
  id: orderId,
  user_id: "buyer",
  tenant_id: "merchant",
  checkout_attempt_guarded: false,
  checkout_financial_review: null,
  failure_reason: null,
  refund_amount: null,
  currency: "USD",
  square_order_id: "square",
  payment_transaction_id: null,
  fulfillment_status: "unfulfilled",
  status: "paid",
  subtotal: 0,
  total: 0,
  tax_amount: 0,
  shipping: 0,
  fulfillment: "pickup" as string | null,
  created_at: "2026-11-24T00:00:00Z",
};
type Options = {
  evidence?: Record<string, unknown>;
  requestedId?: string;
  reconcile?: boolean;
  attemptState?: "unknown" | "ready";
  authFailure?: boolean;
  user?: string | null;
  status?: string;
  order?: typeof order | null;
  token?: string;
  tokenOrder?: string | null;
  rows?: unknown;
  count?: number;
  readError?: boolean;
};
async function observe(options: Options = {}) {
  const reads: string[] = [];
  const jobs: { p_unique_key: string }[] = [];
  function client(access: string) {
    return {
      rpc: (_name: string, args: { p_unique_key: string }) => {
        jobs.push(args);
        return Promise.resolve({ error: null });
      },
      auth: {
        getUser: () => {
          if (options.authFailure) return Promise.reject(Error("session unavailable"));
          return Promise.resolve({
            data: {
              user: options.user === null ? null : { id: options.user ?? "buyer" },
            },
          });
        },
      },
      from(table: string) {
        reads.push(access + "." + table);
        let exact = false;
        let columns = "";
        const filters: Record<string, string> = {};
        const selected =
          options.order === undefined
            ? { ...order, status: options.status ?? order.status }
            : options.order;
        const result = () => {
          if (table === "checkout_payment_attempts")
            return {
              data: options.attemptState
                ? {
                    id: item.id,
                    orderId,
                    sequence: 1,
                    state: options.attemptState,
                    method: "card",
                    amountCents: 1000,
                    currency: "USD",
                    squareIdempotencyKey: item.id,
                    requestDigest:
                      options.attemptState === "unknown" ? "a".repeat(64) : null,
                    providerPaymentId: null,
                  }
                : null,
            };
          if (table === "orders" && columns.includes("checkout_financial_facts")) {
            if (access !== "admin" || filters.id !== orderId)
              throw Error("Unscoped financial read");
            return {
              data: {
                ...selected,
                facts: [],
                attempts: [],
                refunds: [],
                factCount: [{ count: 0 }],
                attemptCount: [{ count: 0 }],
                refundCount: [{ count: 0 }],
                ...options.evidence,
              },
            };
          }
          if (table === "orders")
            return {
              data:
                selected && (!filters.user_id || filters.user_id === selected.user_id)
                  ? selected
                  : null,
            };
          if (table === "order_access_tokens")
            return {
              data: options.tokenOrder
                ? { id: "token", order_id: options.tokenOrder }
                : null,
            };
          if (table === "order_items")
            return {
              data: options.rows === undefined ? [item] : options.rows,
              count:
                exact &&
                filters.order_id === orderId &&
                columns === "id, order_id, product_id, variant_id, quantity"
                  ? (options.count ?? 1)
                  : null,
              error: options.readError ? Error("read failed") : null,
            };
          return { data: [] };
        };
        const q = {
          select: (fields: string, projection?: { count?: string }) => {
            columns = fields;
            exact = projection?.count === "exact";
            return q;
          },
          update: () => q,
          order: () => q,
          limit: () => q,
          gt: () => q,
          eq: (k: string, v: string) => {
            filters[k] = v;
            return q;
          },
          maybeSingle: () => Promise.resolve(result()),
          then: (resolve: (v: unknown) => void) => resolve(result()),
        };
        return q;
      },
    };
  }
  jest.mocked(createSupabaseServerClient).mockResolvedValue(client("session") as never);
  jest.mocked(createSupabaseAdminClient).mockReturnValue(client("admin") as never);
  const requestedId = options.requestedId ?? orderId;
  const url = new URL("http://localhost/api/orders/" + requestedId);
  if (options.reconcile) url.searchParams.set("reconcile", "1");
  if (options.token) url.searchParams.set("token", options.token);
  const response = await GET(new NextRequest(url), {
    params: Promise.resolve({ orderId: requestedId }),
  });
  return { status: response.status, data: await response.json(), reads, jobs };
}
test.each(["paid", "shipped"])(
  "projects complete %s account purchase including zero total",
  async (status) => {
    const result = await observe({ status });
    expect(result.status).toBe(200);
    expect(result.data.purchasedLines).toEqual([
      { productId: product, variantId: variant, quantity: 2 },
    ]);
    expect(result.reads).toEqual([
      "session.orders",
      "session.order_events",
      "admin.orders",
      "session.order_items",
    ]);
  },
);
test.each([false, true])(
  "guest token can read independently of account lookup failure %s",
  async (authFailure) => {
    const result = await observe({
      authFailure,
      user: null,
      token: "guest",
      tokenOrder: orderId,
    });
    expect(result.status).toBe(200);
    expect(result.data.purchasedLines).toHaveLength(1);
    expect(result.reads.indexOf("admin.order_access_tokens")).toBeLessThan(
      result.reads.indexOf("admin.order_items"),
    );
  },
);
test.each([
  { user: "other" },
  { user: null, token: "wrong" },
  { user: null, token: "wrong-order", tokenOrder: "elsewhere" },
  { order: null },
  { order: { ...order, id: "wrong" } },
])("denied observation receives no items", async (options) => {
  const result = await observe(options);
  expect(result.status).toBeGreaterThanOrEqual(400);
  expect(result.reads.some((table) => table.endsWith("order_items"))).toBe(false);
});
test.each(["pending", "processing", "review", "canceled"])(
  "%s does not query items",
  async (status) => {
    const result = await observe({ status });
    expect(result.data.purchasedLines).toBeNull();
    expect(result.reads).toEqual([
      "session.orders",
      "session.order_events",
      "admin.orders",
    ]);
  },
);
test.each([
  { count: 2 },
  { rows: [], count: 0 },
  { rows: "malformed" },
  { readError: true },
  { rows: [{ ...item, product_id: null }] },
  { rows: [{ ...item, variant_id: null }] },
  { rows: [{ ...item, quantity: 0 }] },
  { rows: [{ ...item, quantity: Number.MAX_SAFE_INTEGER + 1 }] },
  { rows: [{ ...item, order_id: "other" }] },
  {
    rows: [item, { ...item, variant_id: "30000000-0000-4000-8000-000000000002" }],
    count: 2,
  },
  { rows: [item, { ...item, id: "40000000-0000-4000-8000-000000000002" }], count: 2 },
])("incomplete evidence preserves receipt", async (options) => {
  const result = await observe(options);
  expect(result.status).toBe(200);
  expect(result.data.purchasedLines).toBeNull();
});

test("the real GET returns 400 for an invalid link before accessing order data", async () => {
  const result = await observe({ requestedId: "never-verified" });
  expect(result.status).toBe(400);
  expect(result.reads).toEqual([]);
});
test("legacy null fulfillment retains the paid projection and totals", async () => {
  const result = await observe({ order: { ...order, fulfillment: null } });
  expect(result.status).toBe(200);
  expect(result.data).toMatchObject({
    fulfillment: null,
    total: 0,
    purchasedLines: [{ productId: product, variantId: variant, quantity: 2 }],
  });
});
test("unknown non-null fulfillment supplies no receipt evidence", async () => {
  const result = await observe({ order: { ...order, fulfillment: "legacy-unknown" } });
  expect(result.status).toBe(500);
  expect(result.reads).not.toContain("session.order_items");
});

test.each([
  ["unknown", "payment_attempt:" + item.id],
  ["ready", null],
  [undefined, "legacy_payment_order:" + orderId],
] as const)(
  "authorized pending GET shares the original recovery job for %s",
  async (attemptState, key) => {
    const result = await observe({ status: "pending", reconcile: true, attemptState });
    expect(result.status).toBe(200);
    expect(result.jobs.map((job) => job.p_unique_key)).toEqual(key ? [key] : []);
  },
);
test("denied GET cannot request recovery", async () => {
  const result = await observe({ user: "other", status: "pending", reconcile: true });
  expect(result.status).toBe(401);
  expect(result.jobs).toEqual([]);
  expect(result.reads).not.toContain("admin.checkout_payment_attempts");
});

const attempt = {
  sequence: 1,
  id: item.id,
  order_id: orderId,
  provider_payment_id: "pay",
  square_order_id: "square",
  amount_cents: 1000,
  currency: "USD",
  state: "succeeded",
};
const capture = {
  order_id: orderId,
  kind: "payment",
  provider_id: "pay",
  provider_version: "opaque",
  payment_id: "pay",
  amount_cents: 1000,
  currency: "USD",
  status: "COMPLETED",
};
const refund = {
  order_id: orderId,
  tenant_id: "merchant",
  square_refund_id: "refund",
  square_payment_id: "pay",
  status: "COMPLETED",
  amount_cents: 500,
  currency: "USD",
  checkout_status_conflict: false,
};
const ledger = {
  payment_transaction_id: "pay",
  checkout_attempt_guarded: true,
  total: 10,
  attempts: [attempt],
  attemptCount: [{ count: 1 }],
  facts: [capture],
  factCount: [{ count: 1 }],
};
test("real GET returns Task6 refund before capture even with pending compatibility status", async () => {
  const result = await observe({
    status: "pending",
    evidence: {
      ...ledger,
      facts: [{ ...capture, kind: "refund", provider_id: "refund", amount_cents: 500 }],
      refunds: [refund],
      refundCount: [{ count: 1 }],
    },
  });
  expect(result.data).toMatchObject({
    status: "pending",
    financial: {
      source: "ledger",
      snapshot: {
        orderId,
        financialState: "partially_refunded",
        capturedCents: 0,
        refundedCents: 500,
        reviewReason: null,
      },
    },
    purchasedLines: null,
  });
});
test.each(["paid", "shipped", "pending"])(
  "real GET rejects incompatible %s settlement evidence",
  async (status) => {
    const result = await observe({
      status,
      evidence:
        status === "pending"
          ? ledger
          : { ...ledger, facts: [], factCount: [{ count: 0 }] },
    });
    expect(result.data.financial.source).toEqual("ledger");
    expect(result.data.purchasedLines).toBeNull();
    expect(result.reads).not.toContain("session.order_items");
  },
);
test("real GET counts one capture across opaque revisions and earlier sequence", async () => {
  const result = await observe({
    evidence: {
      ...ledger,
      facts: [capture, { ...capture, provider_version: "a" }],
      factCount: [{ count: 2 }],
      attempts: [
        attempt,
        {
          ...attempt,
          sequence: 2,
          id: variant,
          provider_payment_id: null,
          state: "ready",
        },
      ],
      attemptCount: [{ count: 2 }],
    },
  });
  expect(result.data.financial.snapshot).toMatchObject({
    revision: "2",
    capturedCents: 1000,
    financialState: "paid",
    reviewReason: null,
  });
  expect(result.data.purchasedLines).toHaveLength(1);
});
test.each([
  { ...ledger, factCount: [{ count: 2 }] },
  {
    ...ledger,
    facts: [capture, { ...capture, status: "FAILED" }],
    factCount: [{ count: 2 }],
  },
  { ...ledger, attempts: [{ ...attempt, currency: "EUR" }] },
  { ...ledger, payment_transaction_id: "replacement" },
  {
    ...ledger,
    facts: [
      capture,
      { ...capture, kind: "refund", provider_id: "refund", amount_cents: 500 },
    ],
    factCount: [{ count: 2 }],
  },
])(
  "real GET with incomplete/contradictory ledger withholds purchase",
  async (evidence) => {
    const result = await observe({ evidence });
    expect(result.data.financial.source).toBe("unavailable");
    expect(result.data.purchasedLines).toBeNull();
  },
);
test("authorized projection rechecks account/tenant binding", async () => {
  const result = await observe({ evidence: { ...ledger, user_id: "replacement" } });
  expect(result.status).toBeGreaterThanOrEqual(400);
  expect(result.data.financial).toBeUndefined();
  expect(result.reads).not.toContain("session.order_items");
});

test("real GET retains multiple independently captured payments and sticky review", async () => {
  const result = await observe({
    evidence: {
      ...ledger,
      attempts: [
        attempt,
        { ...attempt, sequence: 2, id: variant, provider_payment_id: "pay2" },
      ],
      attemptCount: [{ count: 2 }],
      facts: [capture, { ...capture, provider_id: "pay2", payment_id: "pay2" }],
      factCount: [{ count: 2 }],
    },
  });
  expect(result.data.financial.snapshot).toMatchObject({
    capturedCents: 2000,
    reviewReason: "square_multiple_captures",
  });
  expect(result.data.purchasedLines).toBeNull();
});
test("real GET keeps completed corroborated refund with sticky conflict", async () => {
  const result = await observe({
    evidence: {
      ...ledger,
      facts: [
        capture,
        {
          ...capture,
          kind: "refund",
          provider_id: "refund",
          amount_cents: 500,
          status: "PENDING",
        },
      ],
      factCount: [{ count: 2 }],
      refunds: [{ ...refund, checkout_status_conflict: true }],
      refundCount: [{ count: 1 }],
      refund_amount: 500,
    },
  });
  expect(result.data.financial.snapshot).toMatchObject({
    capturedCents: 1000,
    refundedCents: 500,
    reviewReason: "square_status_conflict",
    financialState: "partially_refunded",
  });
  expect(result.data.purchasedLines).toBeNull();
});
test("historical payment binding is independent of compatibility and migrated review remains sticky", async () => {
  const result = await observe({
    evidence: {
      ...ledger,
      checkout_attempt_guarded: false,
      payment_transaction_id: "pay",
      checkout_financial_review: "square_payment_high_risk",
    },
  });
  expect(result.data.financial.snapshot).toMatchObject({
    capturedCents: 1000,
    reviewReason: "square_payment_high_risk",
  });
  expect(result.data.purchasedLines).toBeNull();
  const wrong = await observe({
    evidence: {
      ...ledger,
      checkout_attempt_guarded: false,
      payment_transaction_id: "other",
    },
  });
  expect(wrong.data.financial.source).toEqual("unavailable");
  expect(wrong.data.purchasedLines).toBeNull();
});

test.each(["refunded", "partially_refunded"])(
  "guarded %s status alone cannot create refund money",
  async (status) => {
    const result = await observe({ status, evidence: ledger });
    expect(result.data.financial).toMatchObject({
      source: "ledger",
      snapshot: { financialState: "paid", capturedCents: 1000, refundedCents: 0 },
    });
    expect(result.data.purchasedLines).toBeNull();
  },
);
test.each([0, 500])(
  "guarded refund floor cannot bypass independent completed cents %i",
  async (cents) => {
    const result = await observe({
      status: "paid",
      evidence: {
        ...ledger,
        refund_amount: 800,
        facts: cents
          ? [
              capture,
              { ...capture, kind: "refund", provider_id: "refund", amount_cents: cents },
            ]
          : [capture],
        factCount: [{ count: cents ? 2 : 1 }],
        refunds: cents ? [refund] : [],
        refundCount: [{ count: cents ? 1 : 0 }],
      },
    });
    expect(result.data.financial.source).toBe("unavailable");
    expect(result.data.purchasedLines).toBeNull();
  },
);
test.each([
  ["refunded", 0, 1000, "refunded"],
  ["paid", 800, 800, "partially_refunded"],
  ["partially_refunded", 0, 0, "partially_refunded"],
] as const)(
  "bound legacy %s preserves historical refund floor",
  async (status, persisted, refundedCents, financialState) => {
    const result = await observe({
      status,
      evidence: { ...ledger, checkout_attempt_guarded: false, refund_amount: persisted },
    });
    expect(result.data.financial).toMatchObject({
      source: "ledger",
      snapshot: { financialState, capturedCents: 1000, refundedCents },
    });
    expect(result.data.purchasedLines).toBeNull();
  },
);
test("guarded completed refund object without matching verified facts cannot establish money", async () => {
  const result = await observe({
    evidence: { ...ledger, refunds: [refund], refundCount: [{ count: 1 }] },
  });
  expect(result.data.financial.source).toBe("unavailable");
  expect(result.data.purchasedLines).toBeNull();
});
