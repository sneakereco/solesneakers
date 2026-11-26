jest.mock("posthog-js", () => ({
  __esModule: true,
  default: {
    init: jest.fn(),
    get_session_id: jest.fn(),
    get_distinct_id: jest.fn(),
    identify: jest.fn(),
    reset: jest.fn(),
    capture: jest.fn(),
    onSessionId: jest.fn(),
    unregister: jest.fn(),
    unregister_for_session: jest.fn(),
    opt_out_capturing: jest.fn(),
    set_config: jest.fn(),
  },
}));
import posthog from "posthog-js";
import {
  getCheckoutTrackingContext,
  initializeMeasurement,
  revokeMeasurement,
  setMeasurementAccount,
  identifyConsentingCustomer,
} from "@/Modules/Analytics/Source/Features/VisitorMeasurement/client";
import { validEnv } from "../Configuration/config-fixture";
import { configuredMeasurement } from "@/Modules/Analytics/Source/Features/VisitorMeasurement/host-gate";
const receiptId = "123e4567-e89b-42d3-a456-426614174000";
const visitor = "123e4567-e89b-42d3-a456-426614174001";
const session = "123e4567-e89b-42d3-a456-426614174002";
it("discards identity responses after account change and after withdrawal", async () => {
  const original = process.env;
  process.env = { ...original, ...validEnv };
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: storage,
      sessionStorage: storage,
      location: new URL("https://soles-stg.vercel.app/store"),
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { cookie: "", referrer: "" },
  });
  jest.mocked(posthog.init).mockReturnValue(posthog);
  jest.mocked(posthog.get_distinct_id).mockReturnValue(visitor);
  jest.mocked(posthog.get_session_id).mockReturnValue(session);
  let finish!: (response: Response) => void;
  const fetcher = jest.spyOn(globalThis, "fetch").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  try {
    setMeasurementAccount(null, false);
    initializeMeasurement(configuredMeasurement()!, { choice: "accepted", receiptId });
    expect(getCheckoutTrackingContext()).toMatchObject({
      visitorId: visitor,
      sessionId: session,
      receiptId,
    });
    setMeasurementAccount("first", false);
    const stale = identifyConsentingCustomer();
    setMeasurementAccount("second", false);
    finish(Response.json({ buyerKey: "sole-buyer:v1:" + "a".repeat(64) }));
    await stale;
    expect(posthog.identify).not.toHaveBeenCalled();
    const revoked = identifyConsentingCustomer();
    revokeMeasurement();
    finish(Response.json({ buyerKey: "sole-buyer:v1:" + "b".repeat(64) }));
    await revoked;
    expect(posthog.identify).not.toHaveBeenCalled();
    expect(getCheckoutTrackingContext()).toBeNull();
  } finally {
    fetcher.mockRestore();
    process.env = original;
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "document");
  }
});
