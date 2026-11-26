// Portable core: no Node/npm/k6 globals. Response schemas deliberately reject
// login pages and HTTP-200 error envelopes instead of treating them as success.
export function roleForSlot(slot, total) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= total)
    throw Error("Invalid shopper slot");
  if (total < 20 && slot === total - 1) return 97.5;
  if (total >= 100) return ((slot * 37) % 100) + 0.5;
  return (((slot + 0.5) * 100) / total) % 100;
}
function json(response) {
  try {
    return typeof response.body === "string" ? JSON.parse(response.body) : response.body;
  } catch {
    throw Error("Response schema is not JSON");
  }
}
function fail(message) {
  throw Error(message);
}
export async function requestOperation(
  transport,
  operation,
  path,
  body,
  validate,
  { stockConflict = false, page = false, headers } = {},
) {
  const started = transport.nowMs();
  const tags = {
    operation,
    route: path.split("?")[0].replace(/[a-f0-9]{8}-[a-f0-9-]{27}/gi, ":id"),
    phase: transport.measurementPhase?.(started) ?? "hold",
  };
  transport.emit("operation_offered", 1, tags);
  let response;
  let outcome = "technical";
  try {
    response = await transport.request({
      method: body ? "POST" : "GET",
      path,
      body,
      operation,
      headers,
      phase: tags.phase,
    });
    const value = page ? response.body : json(response);
    if (
      stockConflict &&
      response.status === 409 &&
      value?.code === "insufficient_stock"
    ) {
      outcome = "stock-conflict";
      return { conflict: true };
    }
    if (response.status < 200 || response.status >= 300)
      fail(`${operation} HTTP ${response.status}`);
    if (!validate(value, response)) fail(`${operation} response schema invalid`);
    outcome = "success";
    return value;
  } finally {
    transport.emit("operation_ms", response?.timing ?? transport.nowMs() - started, {
      ...tags,
      outcome,
    });
    transport.emit("technical_failure", outcome === "technical" ? 1 : 0, tags);
    transport.emit("technical_attempts", 1, tags);
    if (outcome === "technical") transport.emit("technical_errors", 1, tags);
    transport.emit("operation_completed", 1, { ...tags, outcome });
  }
}
const pause = async (plan, transport, key) => {
  const [min, max] = plan.pauses[key];
  await transport.pause(min + (max - min) * (transport.random?.() ?? 0.5));
};
export async function runCatalogJourney(
  session,
  plan,
  transport,
  { search = false } = {},
) {
  await transport.replayNavigation?.();
  await requestOperation(
    transport,
    "page",
    search ? "/store?q=Load" : "/store",
    null,
    (x) => typeof x === "string" && /<html|<!doctype/i.test(x),
    { page: true },
  );
  await requestOperation(
    transport,
    "catalog",
    search
      ? `/api/store/products?q=${encodeURIComponent(session.search ?? "Load")}`
      : "/api/store/products?page=1&limit=20",
    null,
    (x) => Array.isArray(x?.products) && Number.isFinite(x.total),
  );
  if (session.productId) {
    await requestOperation(
      transport,
      "page",
      `/store/${session.productId}`,
      null,
      (x) => typeof x === "string" && /<html|<!doctype/i.test(x),
      { page: true },
    );
  }
  await pause(plan, transport, "browse");
}
export async function runCartJourney(session, plan, transport) {
  const value = await requestOperation(
    transport,
    "cart_validate",
    "/api/cart/validate",
    { items: session.items },
    (x) => Array.isArray(x?.items) && Array.isArray(x.removed),
  );
  session.items = value.items.map(({ productId, variantId, quantity }) => ({
    productId,
    variantId,
    quantity,
  }));
  if (!session.items.length)
    transport.emit("stock_unavailable", 1, { operation: "cart_validate" });
  await pause(plan, transport, "cart");
  return value;
}
export async function runCheckoutJourney(session, plan, transport) {
  const phase = transport.measurementPhase?.(transport.nowMs()) ?? "hold";
  try {
    const result = await executeCheckoutJourney(session, plan, transport);
    if (!["stock-conflict", "stock-unavailable"].includes(result.classification))
      transport.emit(
        "eligible_checkout_completed",
        result.classification === "completed" ? 1 : 0,
        { phase },
      );
    return result;
  } catch (error) {
    transport.emit("eligible_checkout_completed", 0, { phase });
    throw error;
  }
}
async function executeCheckoutJourney(session, plan, transport) {
  if (!session.items?.length)
    return { status: "not-started", classification: "stock-unavailable" };
  const started = transport.nowMs();
  const fulfillment = session.fulfillment ?? "ship";
  const quote =
    session.primedQuote ??
    (await requestOperation(
      transport,
      "quote",
      "/api/checkout/quote",
      {
        items: session.items,
        fulfillment,
        shippingAddress: fulfillment === "ship" ? session.address : null,
      },
      (x) =>
        x?.completeness === "exact" &&
        /^[a-f0-9]{64}$/.test(x.quoteFingerprint) &&
        Number.isSafeInteger(x.totals?.totalCents) &&
        x.totals.totalCents > 0,
    ));
  if (!session.isRush) await pause(plan, transport, "checkout");
  const { name, phone, ...physical } = session.address;
  const prepared = await requestOperation(
    transport,
    "prepare",
    "/api/checkout/prepare",
    {
      items: session.items,
      fulfillment,
      idempotencyKey: session.idempotencyKey,
      deviceSessionId: session.deviceId,
      paymentMethod: "card",
      quoteFingerprint: quote.quoteFingerprint,
      buyerEmail: session.email,
      shippingAddress: fulfillment === "ship" ? session.address : null,
      billingAddress: { givenName: "Load", familyName: "Buyer", phone, ...physical },
      pickupContact: fulfillment === "pickup" ? { name, phone } : null,
    },
    (x) =>
      /^[a-f0-9-]{36}$/i.test(x?.orderId) &&
      Number.isSafeInteger(x.totals?.totalCents) &&
      x.totals.totalCents === quote.totals.totalCents,
    { stockConflict: true },
  );
  if (prepared.conflict)
    return { status: "not-accepted", classification: "stock-conflict" };
  const acceptedAt = transport.nowMs();
  transport.emit("accepted_order", 1, { operation: "prepare" });
  // References remain private transport state; metric tags never carry IDs.
  transport.accepted?.({
    orderId: prepared.orderId,
    guestAccessToken: prepared.guestAccessToken,
  });
  const permit = await requestOperation(
    transport,
    "permit",
    "/api/checkout/payment-permit",
    {
      orderId: prepared.orderId,
      guestAccessToken: prepared.guestAccessToken ?? null,
      deviceSessionId: session.deviceId,
      method: "card",
      turnstileToken: `load-turnstile:${session.runId}:${session.slot}`,
    },
    (x) => typeof x?.permit === "string" && x.permit.length > 0,
  );
  const payment = await requestOperation(
    transport,
    "pay",
    "/api/checkout/pay",
    { permit: permit.permit, sourceId: session.sourceId ?? "load-source-approved" },
    (x) =>
      x?.orderId === prepared.orderId &&
      ["COMPLETED", "APPROVED", "PENDING", "UNKNOWN"].includes(x.status),
  );
  const token = prepared.guestAccessToken
    ? `&token=${encodeURIComponent(prepared.guestAccessToken)}`
    : "";
  const deadline = acceptedAt + 30000;
  while (transport.nowMs() <= deadline) {
    const status = await requestOperation(
      transport,
      "order_poll",
      `/api/orders/${prepared.orderId}?reconcile=1${token}`,
      null,
      (x) => x?.id === prepared.orderId && typeof x.status === "string",
    );
    if (
      [
        "paid",
        "processing",
        "completed",
        "shipped",
        "ready_for_pickup",
        "picked_up",
        "delivered",
      ].includes(status.status)
    ) {
      transport.emit("session_checkout_ms", transport.nowMs() - started, {});
      return {
        orderId: prepared.orderId,
        paymentId: payment.paymentId,
        status: status.status,
        classification: transport.nowMs() <= deadline ? "completed" : "completed-late",
        durationMs: transport.nowMs() - started,
      };
    }
    if (["canceled", "cancelled", "expired", "failed"].includes(status.status)) {
      return {
        orderId: prepared.orderId,
        status: status.status,
        classification: "lost-outcome",
      };
    }
    if (transport.nowMs() + 2000 > deadline) break;
    await transport.pause(2);
  }
  return {
    orderId: prepared.orderId,
    paymentId: payment.paymentId,
    status: "pending",
    classification: "outcome-timeout",
  };
}
