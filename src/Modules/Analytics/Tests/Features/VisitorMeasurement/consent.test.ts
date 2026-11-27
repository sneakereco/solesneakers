jest.mock("posthog-js", () => ({ __esModule: true, default: {} }));
import {
  getAnalyticsConsent,
  setAnalyticsConsent,
} from "@/Modules/Analytics/Source/Features/VisitorMeasurement/consent";
import { getCheckoutTrackingContext } from "@/Modules/Analytics/Source/Features/VisitorMeasurement/client";

const receiptId = "123e4567-e89b-42d3-a456-426614174000";
it("keeps a failed withdrawal pending across reload until the server acknowledges it", async () => {
  const stored = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => stored.set(k, v),
    removeItem: (k: string) => stored.delete(k),
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  });
  const request = jest.spyOn(globalThis, "fetch");
  try {
    request.mockResolvedValueOnce(Response.json({ choice: "accepted", receiptId }));
    expect(await getAnalyticsConsent()).toEqual({ choice: "accepted", receiptId });
    request.mockRejectedValueOnce(new Error("offline"));
    expect(await setAnalyticsConsent("declined")).toEqual({
      choice: "declined",
      pending: true,
    });
    expect(getCheckoutTrackingContext()).toBeNull();
    jest.resetModules();
    const restarted = await import(
      "@/Modules/Analytics/Source/Features/VisitorMeasurement/consent"
    );
    request.mockResolvedValueOnce(Response.json({ choice: "declined" }));
    expect(await restarted.getAnalyticsConsent()).toEqual({ choice: "declined" });
    expect(request.mock.calls.at(-1)?.[1]?.method).toBe("POST");
    expect(stored.size).toBe(0);
  } finally {
    request.mockRestore();
    Reflect.deleteProperty(globalThis, "window");
  }
});
