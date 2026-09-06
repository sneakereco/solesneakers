jest.mock("botid/server", () => ({
  checkBotId: jest.fn(),
}));

import { checkBotId } from "botid/server";

import { verifyCheckoutBrowser } from "@/lib/security/checkout-bot";

const mockCheckBotId = jest.mocked(checkBotId);

describe("verifyCheckoutBrowser", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("allows a browser that passes BotID Deep Analysis", async () => {
    mockCheckBotId.mockResolvedValue({ isBot: false } as never);

    await expect(verifyCheckoutBrowser()).resolves.toEqual({
      allowed: true,
      reason: "passed",
    });
    expect(mockCheckBotId).toHaveBeenCalledWith({
      advancedOptions: { checkLevel: "deepAnalysis" },
    });
  });

  it("blocks a request BotID classifies as a bot", async () => {
    mockCheckBotId.mockResolvedValue({ isBot: true } as never);

    await expect(verifyCheckoutBrowser()).resolves.toEqual({
      allowed: false,
      reason: "bot",
    });
  });

  it("fails closed when BotID verification is unavailable", async () => {
    mockCheckBotId.mockRejectedValue(new Error("botid unavailable"));

    await expect(verifyCheckoutBrowser()).resolves.toEqual({
      allowed: false,
      reason: "unavailable",
    });
  });
});
