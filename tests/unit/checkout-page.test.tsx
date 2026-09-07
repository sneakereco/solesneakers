jest.mock("@/lib/checkout/checkout-page-access", () => ({
  loadCheckoutPageAccess: jest.fn(),
}));
jest.mock("@/components/checkout/CheckoutClient", () => ({
  CheckoutClient: () => null,
}));

import { CheckoutClient } from "@/components/checkout/CheckoutClient";
import { CheckoutLockedNotice } from "@/components/checkout/CheckoutLockedNotice";
import { loadCheckoutPageAccess } from "@/lib/checkout/checkout-page-access";

import CheckoutPage from "../../app/checkout/page";

describe("app/checkout/page", () => {
  it("renders fulfillment and payment checkout when checkout is open", async () => {
    jest.mocked(loadCheckoutPageAccess).mockResolvedValue({ open: true });

    const result = await CheckoutPage();

    expect(result).not.toBeNull();
    if (!result) {
      throw new Error("Expected the checkout client");
    }
    expect(result.type).toBe(CheckoutClient);
  });

  it("renders the configured notice when the emergency lock is enabled", async () => {
    jest.mocked(loadCheckoutPageAccess).mockResolvedValue({
      open: false,
      message: "Checkout paused for maintenance",
    });

    const result = await CheckoutPage();

    expect(result).not.toBeNull();
    if (!result) {
      throw new Error("Expected the locked checkout notice");
    }
    expect(result.type).toBe(CheckoutLockedNotice);
    expect(result.props.message).toBe("Checkout paused for maintenance");
  });
});
