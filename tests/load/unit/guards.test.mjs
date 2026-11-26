import test from "node:test";
import assert from "node:assert/strict";
import { createErrorGuard } from "../operator/guards.mjs";
test("idle intervals after failed sessions do not erase a severe sustained failure", () => {
  const guard = createErrorGuard();
  assert.equal(guard.observe({ at: 0, attempts: 100, errors: 100 }), false);
  assert.equal(guard.observe({ at: 60000, attempts: 100, errors: 100 }), true);
  const recovered = createErrorGuard();
  recovered.observe({ at: 0, attempts: 100, errors: 100 });
  assert.equal(recovered.observe({ at: 30000, attempts: 200, errors: 100 }), false);
  assert.equal(recovered.observe({ at: 90000, attempts: 200, errors: 100 }), false);
});
test("live inventory guard fails on negative or nonconserved stock", async () => {
  const { inventoryViolations } = await import("../operator/assertions.mjs");
  assert.deepEqual(
    inventoryViolations([{ stock: 0, active: 1, consumed: 0, initial: 1 }]),
    [],
  );
  assert.equal(
    inventoryViolations([{ stock: -1, active: 1, consumed: 1, initial: 1 }]).length,
    1,
  );
});
