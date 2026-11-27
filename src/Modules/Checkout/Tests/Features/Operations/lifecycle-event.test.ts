import { sanitizeLifecycleEvent } from "../../../Source/Features/Operations/lifecycle-event";
import { log, logError } from "@/lib/utils/log";

const requestId = "10000000-0000-4000-8000-000000000001";
const orderId = "20000000-0000-4000-8000-000000000002";
const release = "8e6a574e29066654b17f1031e25f1df9c202c469";

afterEach(() => jest.restoreAllMocks());

it("preserves allowlisted failure codes and preparation phases while discarding private errors", () => {
  const sink = jest.spyOn(console, "error").mockImplementation(() => {});
  logError(new Error("checkout_provider_busy"), {
    layer: "api",
    route: "/api/checkout/prepare",
    phase: "provider_calculate",
    requestId,
  });
  expect(JSON.parse(String(sink.mock.calls[0][0]))).toMatchObject({
    errorCode: "checkout_provider_busy",
    errorType: "Error",
    phase: "provider_calculate",
    requestId,
  });
  logError(
    Object.assign(new Error("PRIVATE_CUSTOMER_ADDRESS"), {
      code: "23505",
      body: "PRIVATE_PROVIDER_BODY",
    }),
    { phase: "PRIVATE_PHASE" },
  );
  expect(JSON.parse(String(sink.mock.calls[1][0]))).toMatchObject({
    errorCode: "database_unique_conflict",
    errorType: "Error",
  });
  expect(String(sink.mock.calls[1][0])).not.toContain("PRIVATE_");
  logError(new Error("PRIVATE_UNKNOWN_ERROR"));
  expect(JSON.parse(String(sink.mock.calls[2][0]))).toMatchObject({
    errorCode: "unclassified",
    errorType: "Error",
  });
  expect(String(sink.mock.calls[2][0])).not.toContain("PRIVATE_");
});

it("synthetic_credentials_cannot_escape_nested_url_or_error_logging", () => {
  const info = jest.spyOn(console, "info").mockImplementation(() => {});
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  const input = {
    level: "info" as const,
    layer: "api" as const,
    requestId,
    orderId,
    release,
    event: "checkout_request",
    status: 200,
    latencyMs: 19,
    route: "https://store.invalid/api/orders/" + orderId + "?token=SYNTHETIC_SECRET_URL",
    message: "SYNTHETIC_SECRET_MESSAGE",
    nested: [{ token: "SYNTHETIC_SECRET_NESTED" }],
    cookie: "SYNTHETIC_SECRET_COOKIE",
    permit: "SYNTHETIC_SECRET_PERMIT",
    sourceId: "SYNTHETIC_SECRET_SOURCE",
    providerBody: { address: "SYNTHETIC_SECRET_ADDRESS" },
  };
  expect(sanitizeLifecycleEvent(input).route).toBe("/api/orders/:orderId");
  expect(JSON.stringify(sanitizeLifecycleEvent(input))).not.toContain("SYNTHETIC_SECRET");
  const cause = new Error("SYNTHETIC_SECRET_ERROR");
  cause.stack = "SYNTHETIC_SECRET_STACK";
  log(input);
  logError(cause, input);
  for (const calls of [info.mock.calls, error.mock.calls]) {
    expect(calls).toHaveLength(1);
    const line = String(calls[0][0]);
    expect(line.includes("SYNTHETIC_SECRET")).toBe(false);
    expect(JSON.parse(line)).toMatchObject({
      route: "/api/orders/:orderId",
      requestId,
      orderId,
      release,
    });
  }
});
it("reports request percentiles, failures, actual gateway calls and admission without identifier labels", async () => {
  const { observeCheckoutRequest, summarizeCheckoutEvents } = await import(
    "../../../Source/Features/Operations/request-metrics"
  );
  const info = jest.spyOn(console, "info").mockImplementation(() => {});
  await observeCheckoutRequest("/api/checkout/pay", "POST", requestId, () =>
    Promise.resolve(new Response(null, { status: 429 })),
  );
  await expect(
    observeCheckoutRequest("/api/checkout/pay", "POST", requestId, () =>
      Promise.reject(Error("SYNTHETIC_SECRET")),
    ),
  ).rejects.toThrow();
  expect(info.mock.calls.map(([s]) => JSON.parse(s).status)).toEqual([429, 500]);
  const rows = Array.from({ length: 100 }, (_, i) => ({
    event: "checkout_request",
    route: "/api/checkout/pay",
    status: i === 99 ? 503 : 200,
    latency_ms: i + 1,
    orderId,
    requestId,
  }));
  const summary = summarizeCheckoutEvents([
    ...rows,
    { event: "checkout_gateway_call", orderId },
    {
      event: "checkout_admission",
      admissionPhase: "preflight",
      operation: "new_prepare",
      outcome: "denied",
    },
  ]);
  expect(summary.requests["/api/checkout/pay"]).toEqual({
    count: 100,
    errors: 1,
    p95Ms: 95,
    p99Ms: 99,
  });
  expect(summary.gateway).toEqual({ calls: 1, distinctOrders: 1, maxCallsPerOrder: 1 });
  expect(summary.admission["preflight.new_prepare.denied"]).toBe(1);
  expect(JSON.stringify(summary)).not.toContain(orderId);
  expect(JSON.stringify(summary)).not.toContain(requestId);
});

it("keeps the original response and exception when the real sink or correlation accessor throws", async () => {
  const { observeCheckoutRequest } = await import(
    "../../../Source/Features/Operations/request-metrics"
  );
  const original = Error("original_handler_failure"),
    res = new Response(null, { status: 202 });
  jest.spyOn(console, "info").mockImplementation(() => {
    throw Error("local_sink_unavailable");
  });
  await expect(
    observeCheckoutRequest("/api/checkout/pay", "POST", requestId, () =>
      Promise.resolve(res),
    ),
  ).resolves.toBe(res);
  await expect(
    observeCheckoutRequest("/api/checkout/pay", "POST", requestId, () =>
      Promise.reject(original),
    ),
  ).rejects.toBe(original);
  await expect(
    observeCheckoutRequest(
      "/api/checkout/pay",
      "POST",
      requestId,
      () => Promise.resolve(res),
      () => {
        throw Error("correlation_failure");
      },
    ),
  ).resolves.toBe(res);
  const entry = {
    level: "info" as const,
    layer: "api" as const,
    message: "checkout_request",
    get route(): string {
      throw Error("unavailable log field");
    },
  };
  expect(() => log(entry)).not.toThrow();
  expect(() => logError(original, entry)).not.toThrow();
});
