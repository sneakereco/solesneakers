import { initBotId } from "botid/client/core";
jest.mock("botid/client/core", () => ({ initBotId: jest.fn() }));

it("registers deep analysis for every browser checkout entry point", async () => {
  await import("@/instrumentation-client");
  const options = jest.mocked(initBotId).mock.calls[0][0];
  for (const path of ["quote", "prepare", "review", "submit", "payment-permit", "pay"])
    expect(options.protect).toContainEqual({
      path: `/api/checkout/${path}`,
      method: "POST",
      advancedOptions: { checkLevel: "deepAnalysis" },
    });
});
