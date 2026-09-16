const afterCallbacks: Array<() => Promise<void>> = [];

jest.mock("next/server", () => ({
  after: jest.fn((callback: () => Promise<void>) => afterCallbacks.push(callback)),
}));
jest.mock("@/lib/supabase/service-role", () => ({
  createSupabaseAdminClient: jest.fn(() => ({ kind: "admin" })),
}));
jest.mock("@/lib/checkout/checkout-notification-dependencies", () => ({
  createCheckoutNotificationDependencies: jest.fn(() => ({ kind: "dependencies" })),
}));
jest.mock("@/lib/checkout/checkout-notification-worker", () => ({
  processCheckoutNotifications: jest.fn(),
}));
jest.mock("@/lib/utils/log", () => ({ logError: jest.fn() }));

import { createCheckoutNotificationDependencies } from "@/lib/checkout/checkout-notification-dependencies";
import { scheduleCheckoutNotifications } from "@/lib/checkout/checkout-notification-scheduler";
import { processCheckoutNotifications } from "@/lib/checkout/checkout-notification-worker";
import { logError } from "@/lib/utils/log";

beforeEach(() => {
  afterCallbacks.length = 0;
  jest.clearAllMocks();
});

it("dispatches only the paid order's notifications after the response", async () => {
  scheduleCheckoutNotifications("order-1");

  expect(processCheckoutNotifications).not.toHaveBeenCalled();
  expect(afterCallbacks).toHaveLength(1);
  await afterCallbacks[0]();
  expect(createCheckoutNotificationDependencies).toHaveBeenCalledWith(
    { kind: "admin" },
    "order-1",
  );
  expect(processCheckoutNotifications).toHaveBeenCalledWith({ kind: "dependencies" }, 2);
});

it("leaves payment success intact when prompt delivery fails", async () => {
  jest.mocked(processCheckoutNotifications).mockRejectedValueOnce(new Error("smtp"));

  scheduleCheckoutNotifications("order-1");

  await expect(afterCallbacks[0]()).resolves.toBeUndefined();
  expect(logError).toHaveBeenCalledWith(
    expect.objectContaining({ message: "smtp" }),
    expect.objectContaining({
      orderId: "order-1",
      event: "checkout_notification_prompt_delivery_failed",
    }),
  );
});
