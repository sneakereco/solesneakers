import { recordOperationalOutcome } from "@/Modules/Analytics/Source/Features/CommerceFacts/operational-outcome";
const id = "34a328d0-4cfc-4ca7-a9f8-ade895f43c33";
const input = {
  attemptId: id,
  stage: "payment",
  outcome: "unknown",
  method: "card",
  reason: "timeout",
  effectiveAt: "2026-11-25T00:00:00Z",
  resolvedAt: null,
  orderId: null,
} as const;
it("publishes a server attempt after the response and exposes a minimized reporting gap", async () => {
  let scheduled: (() => Promise<void>) | undefined;
  const gap = jest.fn();
  const publish = jest.fn().mockRejectedValue(Error("provider contact and metadata"));
  await recordOperationalOutcome(input, {
    after: (job) => {
      scheduled = job;
    },
    publish,
    gap,
  });
  expect(publish).not.toHaveBeenCalled();
  await scheduled!();
  expect(publish).toHaveBeenCalledWith(input);
  expect(gap).toHaveBeenCalledWith("analytics_operational_outcome_unavailable");
});
