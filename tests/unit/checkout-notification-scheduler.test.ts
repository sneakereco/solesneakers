const afterCallbacks: Array<() => Promise<void>> = [];

jest.mock("next/server", () => ({
  after: jest.fn((callback: () => Promise<void>) => afterCallbacks.push(callback)),
}));
jest.mock("@/lib/supabase/service-role", () => ({
  createSupabaseAdminClient: jest.fn(() => ({ kind: "admin" })),
}));
jest.mock("@/lib/checkout/checkout-notification-dependencies", () => ({
  createCheckoutMailDrainDependencies: jest.fn(() => ({ kind: "dependencies" })),
}));
jest.mock("@/Modules/Checkout/Source/Features/Recovery/notification-drain", () => ({
  drainNotifications: jest.fn(),
}));
jest.mock("@/lib/utils/log", () => ({ logError: jest.fn() }));

import { createCheckoutMailDrainDependencies } from "@/lib/checkout/checkout-notification-dependencies";
import { scheduleCheckoutNotifications } from "@/lib/checkout/checkout-notification-scheduler";
import { drainNotifications } from "@/Modules/Checkout/Source/Features/Recovery/notification-drain";
import { logError } from "@/lib/utils/log";

beforeEach(() => {
  afterCallbacks.length = 0;
  jest.clearAllMocks();
});

it("dispatches only the paid order's notifications after the response", async () => {
  scheduleCheckoutNotifications("order-1");

  expect(drainNotifications).not.toHaveBeenCalled();
  expect(afterCallbacks).toHaveLength(1);
  await afterCallbacks[0]();
  expect(createCheckoutMailDrainDependencies).toHaveBeenCalledWith(
    { kind: "admin" },
    "order-1",
  );
  expect(drainNotifications).toHaveBeenCalledWith(
    expect.objectContaining({ batchSize: 3 }),
    { kind: "dependencies" },
  );
});

it("leaves payment success intact when prompt delivery fails", async () => {
  jest.mocked(drainNotifications).mockRejectedValueOnce(new Error("smtp"));

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
