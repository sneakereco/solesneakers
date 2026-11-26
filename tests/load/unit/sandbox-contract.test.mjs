import test from "node:test";
import assert from "node:assert/strict";
import { runSandboxContract } from "../operator/sandbox-contract.mjs";
test("unresolved provider evidence cannot be called cleaned when authorization is missing", async () => {
  const result = await runSandboxContract(
    { SQUARE_ENVIRONMENT: "sandbox" },
    { load: async () => ({ phase: "captured" }) },
  );
  assert.equal(result.cleanup.status, "incomplete");
});
test("a Sandbox webhook pointed outside the enrolled target prevents all provider writes", async () => {
  let writes = 0;
  const result = await runSandboxContract(
    {
      SQUARE_ENVIRONMENT: "sandbox",
      SQUARE_ACCESS_TOKEN: "private",
      SQUARE_LOCATION_ID: "loc",
    },
    {
      runId: "11111111-1111-4111-8111-111111111111",
      targetDigest: "a".repeat(64),
      baseUrl: "https://stage.test",
      load: async () => null,
      save: async () => {},
      makeClient: () => ({
        locations: { get: async () => ({ location: { id: "loc" } }) },
        webhooks: {
          subscriptions: {
            list: async () => ({
              data: [
                {
                  enabled: true,
                  notificationUrl: "https://production.test/api/webhooks/square",
                },
              ],
              hasNextPage: () => false,
            }),
          },
        },
        orders: {
          calculate: async () => ({
            order: { totalMoney: { amount: 100n, currency: "USD" } },
          }),
          create: async () => {
            writes++;
            throw Error("should not write");
          },
        },
      }),
    },
  );
  assert.equal(result.status, "unmet");
  assert.equal(writes, 0);
});
test("lost Sandbox capture response resumes the same keys and refunds exactly one test capture", async () => {
  let state = null,
    captures = 0,
    lost = true;
  const payments = new Map(),
    orders = new Map(),
    env = {
      SQUARE_ENVIRONMENT: "sandbox",
      SQUARE_ACCESS_TOKEN: "private-auth",
      SQUARE_LOCATION_ID: "location",
    },
    order = { locationId: "location", totalMoney: { amount: 100n, currency: "USD" } };
  const client = {
    webhooks: {
      subscriptions: { list: async () => ({ data: [], hasNextPage: () => false }) },
    },
    locations: { get: async () => ({ location: { id: "location" } }) },
    orders: {
      calculate: async () => ({ order }),
      create: async (input) => {
        orders.set("order", { ...order, ...input.order, id: "order" });
        return { order: orders.get("order") };
      },
      get: async () => ({ order: orders.get("order") }),
    },
    payments: {
      create: async (input) => {
        if (!payments.has(input.idempotencyKey)) {
          captures++;
          payments.set(input.idempotencyKey, {
            id: "payment",
            status: "COMPLETED",
            orderId: input.orderId,
            referenceId: input.referenceId,
            amountMoney: input.amountMoney,
          });
        }
        if (lost) {
          lost = false;
          throw Error("response lost");
        }
        return { payment: payments.get(input.idempotencyKey) };
      },
      get: async () => ({ payment: [...payments.values()][0] }),
    },
    refunds: {
      refundPayment: async () => ({
        refund: {
          id: "refund",
          paymentId: "payment",
          status: "COMPLETED",
          amountMoney: { amount: 100n, currency: "USD" },
        },
      }),
      get: async () => ({
        refund: {
          id: "refund",
          paymentId: "payment",
          status: "COMPLETED",
          amountMoney: { amount: 100n, currency: "USD" },
        },
      }),
    },
  };
  const deps = {
    baseUrl: "https://stage.test",
    runId: "11111111-1111-4111-8111-111111111111",
    targetDigest: "a".repeat(64),
    load: async () => state,
    save: async (value) => {
      assert.ok(!JSON.stringify(value).includes("private-auth"));
      state = structuredClone(value);
    },
    makeClient: () => client,
  };
  assert.equal((await runSandboxContract(env, deps)).cleanup.status, "incomplete");
  const result = await runSandboxContract(env, deps);
  assert.equal(result.status, "pass");
  assert.equal(result.cleanup.status, "cleaned");
  assert.equal(captures, 1);
  await runSandboxContract(env, deps);
  assert.equal(captures, 1);
});
test("provider contract refuses production mode before touching the SDK", async () => {
  const result = await runSandboxContract(
    { SQUARE_ENVIRONMENT: "production" },
    { makeClient: () => assert.fail("production provider call") },
  );
  assert.equal(result.status, "unmet");
});
