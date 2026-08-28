import { NextRequest } from "next/server";

import { checkBot } from "@/proxy/bot";

describe("signed webhook browser-check bypass", () => {
  it("bypasses the legacy user-agent check only for exact signed webhook paths", () => {
    const square = new NextRequest("https://shop.example.com/api/webhooks/square");
    const shippo = new NextRequest("https://shop.example.com/api/webhooks/shippo");
    const nested = new NextRequest("https://shop.example.com/api/webhooks/square/evil");

    expect(checkBot(square, "request-1")).toBeNull();
    expect(checkBot(shippo, "request-2")).toBeNull();
    expect(checkBot(nested, "request-3")?.status).toBe(403);
  });
});
