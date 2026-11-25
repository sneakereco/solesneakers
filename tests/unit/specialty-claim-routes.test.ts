import { getRateLimitPolicyForRequest } from "@/proxy/rate-limit";
import { initBotId } from "botid/client/core";
jest.mock("botid/client/core", () => ({ initBotId: jest.fn() }));
import "@/instrumentation-client";
test("dedicated specialty quota replaces only its three exact POST proxy buckets", () => {
  for (const path of [
    "/api/specialty/eligibility",
    "/api/specialty/claims",
    "/api/specialty/claims/result",
  ]) {
    expect(getRateLimitPolicyForRequest(path, "POST")).toBeNull();
    expect(getRateLimitPolicyForRequest(path + "/evil", "POST")).toMatchObject({
      maxRequests: 30,
    });
    expect(getRateLimitPolicyForRequest(path, "GET")).toMatchObject({ maxRequests: 300 });
  }
});
test("BotID protects validation and submission but not credential-only recovery", () => {
  const config = jest.mocked(initBotId).mock.calls[0][0];
  expect(config.protect).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "/api/specialty/eligibility", method: "POST" }),
      expect.objectContaining({ path: "/api/specialty/claims", method: "POST" }),
    ]),
  );
  expect(config.protect.some((p) => p.path === "/api/specialty/claims/result")).toBe(
    false,
  );
});
