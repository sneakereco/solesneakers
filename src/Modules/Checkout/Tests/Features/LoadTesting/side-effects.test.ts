import { createLoadTestShippingFetch } from "../../../Source/Features/LoadTesting/shipping-adapter";
import { captureLoadTestEmail } from "../../../Source/Features/LoadTesting/mail-sink";
import { validateShippingAddress } from "@/lib/shipping/validate-shipping-address";
import { loadDigest } from "../../../Source/Features/LoadTesting/contracts";
import { shippingAddressKey } from "@/lib/checkout/shipping-address-validation";
import { fixtureRun, fixtureSettings, MemoryRunStore } from "./fixtures";
import { resolveFixtureContext } from "../../../Source/Features/LoadTesting/context";

test("Shippo simulation preserves real address validation and refuses unregistered destinations", async () => {
  const { settings } = fixtureSettings(),
    store = new MemoryRunStore(),
    run = fixtureRun(settings.target.digest);
  await store.put("run", run.runId, run);
  await store.put("fixture", "order:owned", { runId: run.runId, slot: 1 });
  const context = (await resolveFixtureContext("order", "owned", settings, store))!;
  const address = {
    name: "Test Buyer",
    phone: "2025550100",
    line1: "1 Test St",
    line2: null,
    city: "Charleston",
    state: "SC",
    postalCode: "29401",
    country: "US" as const,
  };
  await store.put("fixture", `address:${loadDigest(shippingAddressKey(address))}`, {
    runId: run.runId,
    slot: 1,
  });
  expect(
    (
      await validateShippingAddress(
        address,
        "fixture",
        createLoadTestShippingFetch(context, store),
      )
    ).status,
  ).toBe("valid");
  expect(
    (
      await validateShippingAddress(
        { ...address, line1: "2 Unregistered St" },
        "fixture",
        createLoadTestShippingFetch(context, store),
      )
    ).status,
  ).toBe("unavailable");
});
test("mail sink preserves real failure/retry outcomes without exposing message credentials", async () => {
  const { settings } = fixtureSettings(),
    store = new MemoryRunStore(),
    run = fixtureRun(settings.target.digest);
  await store.put("run", run.runId, run);
  await store.put("fixture", "email:buyer@example.test", { runId: run.runId, slot: 1 });
  await store.put("fault", run.runId, { kind: "smtp-outage" });
  await expect(
    captureLoadTestEmail(
      { to: "buyer@example.test", subject: "Order", html: "?token=secret" },
      settings,
      store,
    ),
  ).rejects.toThrow();
  await store.remove("fault", run.runId);
  const result = await captureLoadTestEmail(
    { to: "buyer@example.test", subject: "Order", html: "?token=secret" },
    settings,
    store,
  );
  expect(result.messageId).toEqual(expect.any(String));
  await expect(
    captureLoadTestEmail(
      { to: "other@example.test", subject: "Order", html: "x" },
      settings,
      store,
    ),
  ).rejects.toThrow();
  expect(
    JSON.stringify(await store.get("mail", loadDigest("buyer@example.test"))),
  ).not.toContain("secret");
});
