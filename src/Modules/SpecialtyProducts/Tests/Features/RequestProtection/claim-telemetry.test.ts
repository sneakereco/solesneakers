jest.mock("@/lib/utils/log", () => ({ log: jest.fn() }));
import { log } from "@/lib/utils/log";
import { recordClaimMetric } from "@/Modules/SpecialtyProducts/Source/Features/RequestProtection/claim-telemetry";
const safe = {
  requestId: "11111111-1111-4111-8111-111111111111",
  event: "award" as const,
  operation: "submit" as const,
  outcome: "won",
  durationMs: 20,
};
beforeEach(() => jest.clearAllMocks());
test("allowlisted event/operation fields survive while contact and credential extras are stripped", () => {
  recordClaimMetric({
    ...safe,
    address: "private-address",
    instagramHandle: "private-handle",
    recoverySecret: "private-credential",
  } as never);
  expect(log).toHaveBeenCalledWith(
    expect.objectContaining({ event: "award", operation: "submit", outcome: "won" }),
  );
  const output = JSON.stringify(jest.mocked(log).mock.calls);
  expect(output).not.toMatch(/private-address|private-handle|private-credential/);
});
test("an arbitrary failure label cannot become a telemetry payload", () => {
  recordClaimMetric({
    ...safe,
    event: "failure",
    failure: "private-error-content",
  } as never);
  expect(log).not.toHaveBeenCalled();
});
