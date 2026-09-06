jest.mock("@/lib/checkout/checkout-page-access", () => ({
  loadCheckoutPageAccess: jest.fn(),
}));
jest.mock("next/navigation", () => ({ redirect: jest.fn() }));

import { redirect } from "next/navigation";

import { CheckoutLockedNotice } from "@/components/checkout/CheckoutLockedNotice";
import { loadCheckoutPageAccess } from "@/lib/checkout/checkout-page-access";

import CheckoutPage from "../../app/checkout/page";

describe("app/checkout/page", () => {
  it("redirects the retired pre-checkout page back to the cart", async () => {
    jest.mocked(loadCheckoutPageAccess).mockResolvedValue({ open: true });

    await CheckoutPage();

    expect(redirect).toHaveBeenCalledWith("/cart");
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
