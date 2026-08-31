jest.mock("@/lib/checkout/checkout-page-access", () => ({
  loadCheckoutPageAccess: jest.fn(),
}));

import { CheckoutClient } from "@/components/checkout/CheckoutClient";
import { CheckoutLockedNotice } from "@/components/checkout/CheckoutLockedNotice";
import { loadCheckoutPageAccess } from "@/lib/checkout/checkout-page-access";

import CheckoutPage from "../../app/checkout/page";

describe("app/checkout/page", () => {
  it("renders the public Square pre-checkout flow when checkout is open", async () => {
    jest.mocked(loadCheckoutPageAccess).mockResolvedValue({ open: true });

    const result = await CheckoutPage();

    expect(result.type).toBe(CheckoutClient);
  });

  it("renders the configured notice when the emergency lock is enabled", async () => {
    jest.mocked(loadCheckoutPageAccess).mockResolvedValue({
      open: false,
      message: "Checkout paused for maintenance",
    });

    const result = await CheckoutPage();

    expect(result.type).toBe(CheckoutLockedNotice);
    expect(result.props.message).toBe("Checkout paused for maintenance");
  });
});
