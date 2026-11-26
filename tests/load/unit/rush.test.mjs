import test from "node:test";
import assert from "node:assert/strict";
import {
  createRushSchedule,
  validateDispatchWindow,
  bindCampaignContract,
} from "../shared/campaign.mjs";
test("rush reserves exact contender background browser leases and rejects clock uncertainty", () => {
  const plan = {
    profile: "rush",
    contenders: 8000,
    background: 1980,
    browserSlots: 20,
    httpSlots: 9980,
    totalSlots: 10000,
    contentionKind: "purchase",
  };
  const clock = [{ sentAt: 1000, receivedAt: 1020, serverAt: 1010 }];
  const schedule = createRushSchedule(plan, clock, 2000);
  assert.deepEqual(
    schedule.ranges.map((x) => x.end - x.start),
    [8000, 1980, 20],
  );
  assert.ok(schedule.releaseAt > 2000);
  assert.throws(
    () =>
      createRushSchedule(plan, [{ sentAt: 0, receivedAt: 2000, serverAt: 1000 }], 2000),
    /clock/,
  );
  assert.equal(
    validateDispatchWindow([schedule.releaseAt, schedule.releaseAt + 1001], schedule)
      .status,
    "fail",
  );
  assert.equal(
    validateDispatchWindow([schedule.releaseAt, schedule.releaseAt + 500], schedule)
      .status,
    "pass",
  );
});
test("absent specialty capability is unmet, and no checkout fallback is invented", () => {
  assert.equal(bindCampaignContract({ capabilities: ["shopping"] }), null);
  assert.throws(
    () =>
      bindCampaignContract({
        capabilities: ["specialty-claims"],
        capabilityContracts: {
          specialtyClaims: { version: 1, claimPath: "https://other.test/claim" },
        },
      }),
    /contract/,
  );
});
