import {
  checkSpecialtyProtection,
  signBrowserCookie,
  readBrowserCookie,
  type ProtectionDependencies,
} from "@/Modules/SpecialtyProducts/Source/Features/RequestProtection/claim-protection";
const request = (origin = "https://example.com") =>
  new Request("https://example.com/api/specialty/claims", {
    method: "POST",
    headers: { origin },
  });
function dependencies(): ProtectionDependencies {
  return {
    siteOrigin: "https://example.com",
    key: "test-protection-secret-32-characters",
    getIp: () => "203.0.113.1",
    storeOpen: () => Promise.resolve(true),
    verifyBrowser: () => Promise.resolve({ allowed: true, reason: "passed" }),
    limit: () => Promise.resolve({ success: true, reset: Date.now() + 1000 }),
  };
}
test("same-origin and trusted IP are required before any claim", async () => {
  expect(
    (
      await checkSpecialtyProtection(
        request("https://evil.example"),
        "submit",
        "browser",
        dependencies(),
      )
    ).allowed,
  ).toBe(false);
  const deps = dependencies();
  deps.getIp = () => null;
  expect(await checkSpecialtyProtection(request(), "submit", "browser", deps)).toEqual({
    allowed: false,
    status: 503,
    retryAfterSeconds: 1,
  });
});
test("validate and submit fail closed on bot/protection outages", async () => {
  const deps = dependencies();
  deps.verifyBrowser = () => Promise.resolve({ allowed: false, reason: "bot" });
  expect(
    await checkSpecialtyProtection(request(), "submit", "browser", deps),
  ).toMatchObject({ allowed: false, status: 403 });
  deps.verifyBrowser = () => Promise.resolve({ allowed: false, reason: "unavailable" });
  expect(
    await checkSpecialtyProtection(request(), "validate", "browser", deps),
  ).toMatchObject({ allowed: false, status: 503 });
  deps.limit = () => {
    return Promise.reject(new Error("redis details"));
  };
  expect(
    await checkSpecialtyProtection(request(), "recover", "browser", deps),
  ).toMatchObject({ allowed: false, status: 503 });
});
test("recovery skips deep BotID and campaign/site availability while retaining quota", async () => {
  const deps = dependencies();
  deps.verifyBrowser = () => {
    return Promise.reject(new Error("provider unavailable"));
  };
  deps.storeOpen = () => Promise.resolve(false);
  expect(await checkSpecialtyProtection(request(), "recover", "browser", deps)).toEqual({
    allowed: true,
  });
});
test("quotas use hashed specialty browser/IP keys and report throttling", async () => {
  const deps = dependencies();
  const buckets: Array<{ key: string; limit: number }> = [];
  deps.limit = (key, limit) => {
    buckets.push({ key, limit });
    return Promise.resolve({ success: limit !== 10, reset: Date.now() + 4000 });
  };
  expect(
    await checkSpecialtyProtection(request(), "submit", "browser-sensitive", deps),
  ).toMatchObject({ allowed: false, status: 429 });
  expect(buckets.map((b) => b.limit).sort((a, b) => a - b)).toEqual([10, 2000]);
  expect(JSON.stringify(buckets)).not.toMatch(/browser-sensitive|203\.0\.113/);
  expect(buckets.every((b) => b.key.startsWith("specialty:"))).toBe(true);
});
test("browser cookie is purpose-signed, expiring, and tamper resistant", () => {
  const cookie = signBrowserCookie("browser-opaque-identifier", 1800000000000, "secret");
  expect(readBrowserCookie(cookie, 1800000000001, "secret")).toBe(
    "browser-opaque-identifier",
  );
  expect(readBrowserCookie(cookie + "x", 1800000000001, "secret")).toBeNull();
  expect(readBrowserCookie(cookie, 1800100000000, "secret")).toBeNull();
  expect(readBrowserCookie(cookie, 1800000000001, "wrong")).toBeNull();
});
