import { randomUUID } from "node:crypto";
import { SquareClient, SquareEnvironment } from "square";
import { z } from "zod";
const id = z.string().regex(/^[\w:-]{1,200}$/),
  stateSchema = z
    .object({
      version: z.literal(1),
      runId: z.string().uuid(),
      targetDigest: z.string().regex(/^[a-f0-9]{64}$/),
      locationId: id,
      orderKey: z.string().uuid(),
      paymentKey: z.string().uuid(),
      refundKey: z.string().uuid(),
      orderId: id.optional(),
      paymentId: id.optional(),
      refundId: id.optional(),
      phase: z.enum(["intent", "ordered", "captured", "refunding", "cleaned"]),
      checks: z.record(z.string(), z.boolean()),
    })
    .strict();
const amount = (money) => money?.currency === "USD" && BigInt(money.amount) === 100n;
export async function runSandboxContract(env, dependencies) {
  if (
    env.SQUARE_ENVIRONMENT !== "sandbox" ||
    !env.SQUARE_ACCESS_TOKEN ||
    !env.SQUARE_LOCATION_ID
  ) {
    let previous;
    try {
      previous = await dependencies.load?.();
    } catch {
      return {
        profile: "sandbox-contract",
        status: "unmet",
        cleanup: { status: "incomplete" },
        reasons: ["Cannot read the provider recovery journal"],
      };
    }
    return {
      profile: "sandbox-contract",
      status: "unmet",
      cleanup: {
        status: previous && previous.phase !== "cleaned" ? "incomplete" : "cleaned",
      },
      reasons: [
        "Authorize the staging Square Sandbox credentials; production mode is forbidden",
      ],
    };
  }
  const {
    runId,
    targetDigest,
    load,
    save,
    makeClient = (options) => new SquareClient(options),
  } = dependencies;
  let state,
    requests = 0;
  const result = (status, reasons = []) => ({
    version: 1,
    runId,
    targetDigest,
    profile: "sandbox-contract",
    status,
    checks: Object.entries(state?.checks ?? {}).map(([name, passed]) => ({
      name,
      status: passed ? "pass" : "unmet",
    })),
    requests,
    cleanup: { status: state?.phase === "cleaned" ? "cleaned" : "incomplete" },
    reasons,
    scope: {
      providerMode: "sandbox",
      capacityProven: false,
      coverage:
        "One USD 1 Sandbox order/capture, idempotent replay, authoritative read and refund; application webhook/browser/native-wallet compatibility is separate",
    },
  });
  try {
    state = stateSchema.parse(
      (await load()) ?? {
        version: 1,
        runId,
        targetDigest,
        locationId: env.SQUARE_LOCATION_ID,
        orderKey: randomUUID(),
        paymentKey: randomUUID(),
        refundKey: randomUUID(),
        phase: "intent",
        checks: {},
      },
    );
    if (
      state.runId !== runId ||
      state.targetDigest !== targetDigest ||
      state.locationId !== env.SQUARE_LOCATION_ID
    )
      throw Error("Sandbox journal identity mismatch");
    if (state.phase === "cleaned") return result("pass");
    await save(state);
    const client = makeClient({
        token: env.SQUARE_ACCESS_TOKEN,
        environment: SquareEnvironment.Sandbox,
        maxRetries: 0,
        timeoutInSeconds: 5,
      }),
      call = async (work) => {
        await dependencies.assertActive?.();
        if (++requests > 12) throw Error("Sandbox request ceiling");
        return work();
      };
    const location = await call(() =>
      client.locations.get({ locationId: state.locationId }),
    );
    if (location.location?.id !== state.locationId)
      throw Error("Sandbox location mismatch");
    state.checks.location = true;
    const subscriptions = await call(() =>
      client.webhooks.subscriptions.list({ includeDisabled: true, limit: 100 }),
    );
    if (
      !Array.isArray(subscriptions.data) ||
      subscriptions.hasNextPage() ||
      !dependencies.baseUrl ||
      subscriptions.data.some(
        (subscription) =>
          subscription.enabled !== false &&
          subscription.notificationUrl !== `${dependencies.baseUrl}/api/webhooks/square`,
      )
    )
      throw Error(
        "Sandbox webhook subscriptions are not isolated to the enrolled target",
      );
    state.checks.webhookIsolation = true;
    if (dependencies.cleanupOnly && !state.paymentId)
      return result("unmet", [
        "No confirmed payment ID; cleanup will not initiate an order or capture. Use explicit recovery to resolve uncertain provider requests.",
      ]);
    const orderInput = {
      locationId: state.locationId,
      referenceId: runId,
      lineItems: [
        {
          name: "Synthetic load contract",
          quantity: "1",
          basePriceMoney: { amount: 100n, currency: "USD" },
        },
      ],
    };
    if (!dependencies.cleanupOnly) {
      const quote = await call(() => client.orders.calculate({ order: orderInput }));
      if (!amount(quote.order?.totalMoney))
        throw Error("Sandbox quote contract mismatch");
      state.checks.quote = true;
      const order = state.orderId
        ? await call(() => client.orders.get({ orderId: state.orderId }))
        : await call(() =>
            client.orders.create({ idempotencyKey: state.orderKey, order: orderInput }),
          );
      if (
        !order.order?.id ||
        order.order.referenceId !== runId ||
        order.order.locationId !== state.locationId ||
        !amount(order.order.totalMoney)
      )
        throw Error("Unowned Sandbox order");
      state.orderId = order.order.id;
      state.phase = "ordered";
      state.checks.order = true;
      await save(state);
      const payload = {
        idempotencyKey: state.paymentKey,
        sourceId: "cnon:card-nonce-ok",
        autocomplete: true,
        amountMoney: { amount: 100n, currency: "USD" },
        orderId: state.orderId,
        locationId: state.locationId,
        referenceId: runId,
      };
      const payment = state.paymentId
        ? await call(() => client.payments.get({ paymentId: state.paymentId }))
        : await call(() => client.payments.create(payload));
      if (
        !payment.payment?.id ||
        payment.payment.status !== "COMPLETED" ||
        payment.payment.orderId !== state.orderId ||
        payment.payment.referenceId !== runId ||
        !amount(payment.payment.amountMoney)
      )
        throw Error("Sandbox capture contract mismatch");
      state.paymentId = payment.payment.id;
      state.phase = "captured";
      state.checks.capture = true;
      await save(state);
      const replay = await call(() => client.payments.create(payload));
      if (replay.payment?.id !== state.paymentId)
        throw Error("Sandbox idempotency mismatch");
      state.checks.idempotency = true;
      const read = await call(() => client.payments.get({ paymentId: state.paymentId }));
      if (
        read.payment?.id !== state.paymentId ||
        read.payment.orderId !== state.orderId ||
        !amount(read.payment.amountMoney)
      )
        throw Error("Sandbox authoritative read mismatch");
      state.checks.authoritativeRead = true;
      await save(state);
    } else {
      const read = await call(() => client.payments.get({ paymentId: state.paymentId }));
      if (
        read.payment?.id !== state.paymentId ||
        read.payment.orderId !== state.orderId ||
        read.payment.referenceId !== runId ||
        !amount(read.payment.amountMoney)
      )
        throw Error("Sandbox cleanup payment ownership mismatch");
    }
    const refund = state.refundId
      ? await call(() => client.refunds.get({ refundId: state.refundId }))
      : await call(() =>
          client.refunds.refundPayment({
            idempotencyKey: state.refundKey,
            paymentId: state.paymentId,
            amountMoney: { amount: 100n, currency: "USD" },
            reason: "Synthetic staging load contract cleanup",
          }),
        );
    if (
      !refund.refund?.id ||
      refund.refund.paymentId !== state.paymentId ||
      !amount(refund.refund.amountMoney)
    )
      throw Error("Sandbox refund ownership mismatch");
    state.refundId = refund.refund.id;
    state.phase = "refunding";
    await save(state);
    if (refund.refund.status !== "COMPLETED")
      return result("unmet", [
        "Sandbox refund is not terminal; recover this same run ID",
      ]);
    state.phase = "cleaned";
    state.checks.refund = true;
    await save(state);
    return result("pass");
  } catch {
    return result("unmet", [
      "Bounded Sandbox contract incomplete; retain its journal and recover this same run ID",
    ]);
  }
}
