import {
  processCheckoutNotifications,
  type CheckoutNotificationWorkerDependencies,
} from "@/lib/checkout/checkout-notification-worker";

function dependencies(): jest.Mocked<CheckoutNotificationWorkerDependencies> {
  return {
    claim: jest.fn().mockResolvedValue([
      {
        id: "notification-1",
        orderId: "order-1",
        kind: "order_confirmation",
        payload: {},
      },
      {
        id: "notification-2",
        orderId: "order-2",
        kind: "refund_confirmation",
        payload: { refundAmountCents: 5000 },
      },
    ]),
    send: jest.fn().mockResolvedValue(undefined),
    markSent: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
  };
}

describe("processCheckoutNotifications", () => {
  it("marks each successfully delivered notification", async () => {
    const deps = dependencies();

    await expect(processCheckoutNotifications(deps, 10)).resolves.toEqual({
      claimed: 2,
      sent: 2,
      failed: 0,
    });
    expect(deps.send).toHaveBeenCalledTimes(2);
    expect(deps.markSent).toHaveBeenCalledWith("notification-1");
    expect(deps.markSent).toHaveBeenCalledWith("notification-2");
  });

  it("records a retryable failure and continues the batch", async () => {
    const deps = dependencies();
    deps.send.mockRejectedValueOnce(new Error("smtp unavailable"));

    await expect(processCheckoutNotifications(deps, 10)).resolves.toEqual({
      claimed: 2,
      sent: 1,
      failed: 1,
    });
    expect(deps.markFailed).toHaveBeenCalledWith("notification-1");
    expect(deps.markSent).toHaveBeenCalledWith("notification-2");
  });
});
