import { createSquareCheckoutOrdersGateway } from "@/lib/square/client";
jest.mock("@/lib/square/config", () => ({
  getSquareConfig: () => ({
    environment: "sandbox",
    accessToken: "inert",
    locationId: "fixture",
  }),
}));
import { CheckoutAttemptLimiter } from "@/lib/checkout/checkout-attempt-limit";

const fixtureBudgets = {
  version: 1 as const,
  revision: "deterministic-fixture",
  ipPerMinute: 150,
  globalPerMinute: 500,
  providers: { square: 3, shippo: 2 },
};
function fixture() {
  let now = 1000;
  const counters = new Map<string, Map<string, number>>();
  // The separate isolated Redis evidence runs the actual script. This deterministic
  // model gives the boundary cases a controlled clock.
  const redis = {
    eval: (_script: string, keys: string[], args: string[]) => {
      const windows = keys.map((key, i) => {
        const [duration, limit, member] = args.slice(i * 3, i * 3 + 3);
        const scores = counters.get(key) ?? new Map<string, number>();
        for (const [id, time] of scores)
          if (time <= now - Number(duration)) scores.delete(id);
        counters.set(key, scores);
        return { scores, member, window: Number(duration), limit: Number(limit) };
      });
      let retry = 0;
      for (const w of windows)
        if (!w.scores.has(w.member) && w.scores.size >= w.limit)
          retry = Math.max(retry, Math.min(...w.scores.values()) + w.window - now);
      if (retry) return Promise.resolve([0, retry]);
      for (const w of windows) if (!w.scores.has(w.member)) w.scores.set(w.member, now);
      return Promise.resolve([1, 0]);
    },
  };
  const limiter = new CheckoutAttemptLimiter(redis, fixtureBudgets);
  return {
    limiter,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
test("shared_ip_is_not_a_three_customer_ceiling", async () => {
  const { limiter } = fixture();
  const results = [];
  for (let i = 0; i < 20; i++) {
    const identity = {
      clientIp: "203.0.113.10",
      shopperBinding: "guest:" + i.toString(16).padStart(64, "0"),
      eventId: "key-" + i,
    };
    results.push(
      await limiter.checkAddressValidation(identity),
      await limiter.check(identity),
      await limiter.admit({
        kind: "resume",
        ip: identity.clientIp,
        shopperBinding: identity.shopperBinding,
      }),
    );
  }
  expect(results.every((r) => r.allowed)).toBe(true);
});
test("distinct keys spend exactly once per shopper and expire on the ten-minute boundary", async () => {
  const { limiter, advance } = fixture();
  const identity = {
    clientIp: "203.0.113.11",
    shopperBinding: "account:original",
    eventId: "first",
  };
  for (let i = 0; i < 5; i++)
    expect((await limiter.check({ ...identity, eventId: "key-" + i })).allowed).toBe(
      true,
    );
  advance(300000);
  expect((await limiter.check({ ...identity, eventId: "key-0" })).allowed).toBe(true);
  expect(
    (
      await limiter.admit({
        kind: "resume",
        ip: identity.clientIp,
        shopperBinding: identity.shopperBinding,
      })
    ).allowed,
  ).toBe(true);
  expect(await limiter.check(identity)).toEqual({
    allowed: false,
    retryAfterSeconds: 300,
  });
  advance(299999);
  expect(await limiter.check(identity)).toEqual({ allowed: false, retryAfterSeconds: 1 });
  advance(1);
  expect((await limiter.check(identity)).allowed).toBe(true);
});

test("authorized attached resume stays available on Redis/config outage, while gateway fails closed", async () => {
  const redis = { eval: jest.fn().mockRejectedValue(Error("offline")) };
  for (const budgets of [fixtureBudgets, null]) {
    const limiter = new CheckoutAttemptLimiter(redis, budgets);
    const input = {
      ip: "203.0.113.1",
      orderId: "order",
      shopperBinding: "account:owner",
    };
    expect((await limiter.admit({ kind: "resume", ...input })).allowed).toBe(true);
    await expect(limiter.admit({ kind: "gateway_attempt", ...input })).rejects.toThrow();
  }
});

test("foreground Square shares one abort through response-body settlement and refuses subsequent calls", async () => {
  const ctl = new AbortController();
  const transport = jest.spyOn(globalThis, "fetch").mockImplementation((_input, init) =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start(controller) {
            init!.signal!.addEventListener("abort", () =>
              controller.error(Error("deadline")),
            );
            queueMicrotask(() => ctl.abort());
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    ),
  );
  try {
    const gateway = createSquareCheckoutOrdersGateway(ctl.signal);
    await expect(gateway.cancel("fixture-order", 1, "fixture-cancel")).rejects.toThrow();
    await expect(gateway.cancel("fixture-order", 1, "fixture-cancel")).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  } finally {
    transport.mockRestore();
  }
});
test("foreground Square does not wait through retry-after beyond the held slot", async () => {
  const transport = jest
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      new Response("{}", { status: 503, headers: { "retry-after": "120" } }),
    );
  try {
    const gateway = createSquareCheckoutOrdersGateway(AbortSignal.timeout(250));
    await expect(gateway.cancel("fixture-order", 1, "fixture-cancel")).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  } finally {
    transport.mockRestore();
  }
});
