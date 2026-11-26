import { SquareClient, SquareEnvironment } from "square";
import { SquareCheckoutOrdersGateway } from "@/lib/square/checkout-orders";
import {
  SquarePaymentsGateway,
  isDefiniteSquarePaymentDecline,
} from "@/lib/square/payments";
import { verifySquarePaymentOrder } from "@/lib/square/payment-order-verification";
import { verifySquareWebhookSignature } from "@/lib/square/webhook";
import {
  createLoadTestSquareFetch,
  dispatchDueEvents,
} from "../../../Source/Features/LoadTesting/square-adapter";
import {
  issuePhaseCredential,
  verifyHarnessRequest,
} from "../../../Source/Features/LoadTesting/context";
import { fixtureRun, fixtureSettings, MemoryRunStore } from "./fixtures";

const orderId = "22222222-2222-4222-8222-222222222222";
const item = {
  productId: "33333333-3333-4333-8333-333333333333",
  variantId: "44444444-4444-4444-8444-444444444444",
  quantity: 1,
  unitPriceCents: 10000,
  unitCostCents: 5000,
  lineTotalCents: 10000,
  variantSku: "load-fixture",
  productName: "Test shoe",
  brand: "Fixture",
  model: "Fixture",
  category: "sneakers",
  condition: "new",
  sizeLabel: "10",
};
const input = {
  localOrderId: orderId,
  idempotencyKey: "order-key",
  fulfillment: "pickup" as const,
  buyerEmail: "buyer@example.test",
  pickupContact: { name: "Test Buyer", phone: "2025550100" },
  subtotalCents: 10000,
  shippingCents: 0,
  shippingAddress: null,
  items: [item],
};
async function setup() {
  const { settings } = fixtureSettings(),
    store = new MemoryRunStore(),
    run = fixtureRun(settings.target.digest);
  await store.put("run", run.runId, run);
  await store.put("fixture", `order:${orderId}`, { runId: run.runId, slot: 1 });
  const context = (await verifyHarnessRequest(
    new Request(`${settings.target.baseUrl}/api/checkout/quote`, {
      headers: {
        "x-load-test-credential": issuePhaseCredential(run, settings),
        "x-load-test-slot": "1",
      },
    }),
    settings,
    store,
  ))!;
  const client = new SquareClient({
    token: "fixture-only",
    environment: SquareEnvironment.Sandbox,
    fetch: createLoadTestSquareFetch(context, store, settings, "TEST_LOCATION"),
    maxRetries: 0,
  });
  return {
    settings,
    store,
    context,
    client,
    orders: new SquareCheckoutOrdersGateway(client.orders, "TEST_LOCATION"),
    payments: new SquarePaymentsGateway(client.payments, "TEST_LOCATION"),
  };
}
describe("stateful Square simulation through the actual SDK", () => {
  test("calculated, created and read money uses SDK bigint parsing consistently", async () => {
    const { orders, client } = await setup();
    const quote = await orders.calculate(input);
    const created = await orders.create(input);
    const read = await client.orders.get({ orderId: created.id });
    expect(quote.totalCents).toBe(10000);
    expect(created.totalCents).toBe(10000);
    expect(read.order?.totalMoney?.amount).toBe(10000n);
    expect(read.order?.referenceId).toBe(orderId);
  });
  test("two SDK instances reuse a capture idempotently and reject changed payment content", async () => {
    const { orders, payments, context, store, settings } = await setup();
    const order = await orders.create(input);
    const paymentInput = {
      localOrderId: orderId,
      squareOrderId: order.id,
      idempotencyKey: "payment-key",
      sourceId: "load-source-approved",
      totalCents: 10000,
      shippingAddress: null,
      billingAddress: null,
    };
    const a = await payments.create(paymentInput);
    const secondClient = new SquareClient({
      token: "fixture-only",
      environment: SquareEnvironment.Sandbox,
      fetch: createLoadTestSquareFetch(context, store, settings, "TEST_LOCATION"),
      maxRetries: 0,
    });
    const b = await new SquarePaymentsGateway(
      secondClient.payments,
      "TEST_LOCATION",
    ).create(paymentInput);
    expect(a.id).toBe(b.id);
    expect(a.status).toBe("COMPLETED");
    await expect(
      payments.create({ ...paymentInput, sourceId: "changed" }),
    ).rejects.toThrow();
    await expect(orders.cancel(order.id, order.version, "cancel-key")).rejects.toThrow();
  });
  test("definite declines and captured response loss remain distinguishable", async () => {
    const { orders, payments, store, context } = await setup();
    const order = await orders.create(input);
    const paymentInput = {
      localOrderId: orderId,
      squareOrderId: order.id,
      idempotencyKey: "payment-key",
      sourceId: "load-source-approved",
      totalCents: 10000,
      shippingAddress: null,
      billingAddress: null,
    };
    await store.put("fault", context.runId, { kind: "decline" });
    let decline: unknown;
    try {
      await payments.create(paymentInput);
    } catch (error) {
      decline = error;
    }
    expect(isDefiniteSquarePaymentDecline(decline)).toBe(true);
    await store.put("fault", context.runId, { kind: "timeout-after-capture" });
    await expect(payments.create(paymentInput)).rejects.toThrow();
    await store.remove("fault", context.runId);
    expect((await orders.getCancellationState(order.id)).hasPayment).toBe(true);
  });
  test("phantom provider events fail real order verification before financial processing", async () => {
    const { orders, client } = await setup();
    const order = await orders.create(input);
    await expect(
      verifySquarePaymentOrder(
        {
          eventId: "event",
          eventType: "payment.updated",
          merchantId: "test",
          locationId: "TEST_LOCATION",
          createdAt: new Date().toISOString(),
          paymentId: "payment",
          squareOrderId: order.id,
          paymentStatus: "COMPLETED",
          amountCents: 10000,
          currency: "USD",
          riskLevel: null,
        },
        {
          getLocalOrder: () => Promise.resolve(null),
          getSquareOrder: () => client.orders.get({ orderId: order.id }),
        },
      ),
    ).rejects.toThrow("square_payment_order_total_mismatch");
  });
  test("queued events are signed, retained after failure and replay safely", async () => {
    const { orders, payments, context, store, settings } = await setup();
    const order = await orders.create(input);
    await payments.create({
      localOrderId: orderId,
      squareOrderId: order.id,
      idempotencyKey: "payment-key",
      sourceId: "load-source-approved",
      totalCents: 10000,
      shippingAddress: null,
      billingAddress: null,
    });
    const failingFetch: typeof fetch = () =>
      Promise.resolve(new Response("failure", { status: 503 }));
    const config = {
      notificationUrl: `${settings.target.baseUrl}/api/webhooks/square`,
      signatureKey: "fixture-signature",
    };
    expect(
      (await dispatchDueEvents(context, store, settings, config, failingFetch)).failed,
    ).toBeGreaterThan(0);
    const bodies: string[] = [];
    const delivered: typeof fetch = async (url, init) => {
      expect(String(url)).toBe(config.notificationUrl);
      expect(
        await verifySquareWebhookSignature({
          rawBody: String(init?.body),
          signature:
            new Headers(init?.headers).get("x-square-hmacsha256-signature") ?? "",
          signatureKey: config.signatureKey,
          notificationUrl: config.notificationUrl,
        }),
      ).toBe(true);
      bodies.push(String(init?.body));
      return new Response("{}", { status: 200 });
    };
    expect(
      (await dispatchDueEvents(context, store, settings, config, delivered)).delivered,
    ).toBeGreaterThan(0);
    expect(
      (await dispatchDueEvents(context, store, settings, config, delivered)).delivered,
    ).toBe(0);
    expect(JSON.parse(bodies[0]).data.object.payment.amount_money.amount).toBe(10000);
  });
});
