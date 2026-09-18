import { NextRequest } from "next/server";
import { checkBot } from "@/proxy/bot";

describe("catalog link previews", () => {
  beforeEach(() => jest.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());
  it.each([
    "Twitterbot/1.0",
    "Slackbot-LinkExpanding 1.0",
    "Discordbot/2.0",
    "TelegramBot",
  ])("lets %s read catalog pages only", (userAgent) => {
    const request = (path: string, method = "GET") =>
      new NextRequest(`https://shopsolesneakers.com${path}`, {
        method,
        headers: { "user-agent": userAgent },
      });
    expect(checkBot(request("/store"), "preview")).toBeNull();
    expect(
      checkBot(request("/store/11111111-1111-4111-8111-111111111111", "HEAD"), "preview"),
    ).toBeNull();
    expect(checkBot(request("/api/checkout/prepare", "POST"), "preview")?.status).toBe(
      403,
    );
    expect(checkBot(request("/admin"), "preview")?.status).toBe(403);
    expect(checkBot(request("/store", "POST"), "preview")?.status).toBe(403);
  });
});
