jest.mock("botid/client/core", () => ({
  initBotId: jest.fn(),
}));

import { initBotId } from "botid/client/core";

import "../../instrumentation-client";

describe("checkout BotID client protection", () => {
  it("protects quote requests that the server verifies", () => {
    expect(initBotId).toHaveBeenCalledWith({
      protect: expect.arrayContaining([
        {
          path: "/api/checkout/quote",
          method: "POST",
          advancedOptions: { checkLevel: "deepAnalysis" },
        },
      ]),
    });
  });
});
