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
  status: "paid",
  subtotal: 0,
  total: 0,
  tax_amount: 0,
  shipping: 0,
  fulfillment: "pickup" as string | null,
  created_at: "2026-11-24T00:00:00Z",
};
type Options = {
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
    expect(result.reads).toEqual(["session.orders", "session.order_events"]);
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
