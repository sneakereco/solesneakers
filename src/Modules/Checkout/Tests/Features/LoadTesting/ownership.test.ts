import { reserveWithLoadOwnership } from "../../../Source/Features/LoadTesting/ownership";
import { fixtureRun, fixtureSettings, MemoryRunStore } from "./fixtures";
import { resolveFixtureContext } from "../../../Source/Features/LoadTesting/context";

test("unregistered buyer identity cannot reserve stock before ownership validation", async () => {
  const { settings } = fixtureSettings(),
    store = new MemoryRunStore(),
    run = fixtureRun(settings.target.digest);
  await store.put("run", run.runId, run);
  await store.put("fixture", "order:owned", { runId: run.runId, slot: 1 });
  const context = (await resolveFixtureContext("order", "owned", settings, store))!;
  let reserved = 0;
  const reserve = () => {
    reserved++;
    return Promise.resolve({ orderId: "new-order" });
  };
  await expect(
    reserveWithLoadOwnership(
      { guestEmail: "foreign@example.test", userId: null },
      reserve,
      { settings, store, context },
    ),
  ).rejects.toThrow();
  expect(reserved).toBe(0);
  const result = await reserveWithLoadOwnership(
    { guestEmail: `slot1@${run.runId}.load.test`, userId: null },
    reserve,
    { settings, store, context },
  );
  expect(result.orderId).toBe("new-order");
  expect(reserved).toBe(1);
  expect(await store.get("fixture", "order:new-order")).toEqual({
    runId: run.runId,
    slot: 1,
  });
});
