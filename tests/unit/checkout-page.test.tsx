jest.mock("@/lib/checkout/checkout-page-access", () => ({
  loadCheckoutPageAccess: jest.fn(),
}));
jest.mock("@/components/checkout/CheckoutClient", () => ({
  CheckoutClient: () => null,
}));
jest.mock("@/lib/checkout/checkout-page-data", () => ({
  loadCheckoutPageData: jest.fn(),
}));
jest.mock("@/lib/utils/log", () => ({
  logError: jest.fn(),
}));

import { CheckoutClient } from "@/components/checkout/CheckoutClient";
import { CheckoutLockedNotice } from "@/components/checkout/CheckoutLockedNotice";
import { CheckoutUnavailable } from "@/components/checkout/CheckoutUnavailable";
import { loadCheckoutPageAccess } from "@/lib/checkout/checkout-page-access";
import { loadCheckoutPageData } from "@/lib/checkout/checkout-page-data";

import CheckoutPage from "../../app/checkout/page";

describe("app/checkout/page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders fulfillment and payment checkout when checkout is open", async () => {
    jest.mocked(loadCheckoutPageAccess).mockResolvedValue({ open: true });
    const initialData = {
      isGuest: true,
      customer: {
        email: "",
        address: {
          name: "",
          phone: "",
          line1: "",
          line2: "",
          city: "",
          state: "",
          postalCode: "",
          country: "US" as const,
        },
      },
      paymentConfig: {
        applicationId: "app-id",
        locationId: "location-id",
        environment: "sandbox" as const,
      },
    };
    jest.mocked(loadCheckoutPageData).mockResolvedValue(initialData);

    const result = await CheckoutPage();

    expect(result).not.toBeNull();
    if (!result) {
      throw new Error("Expected the checkout client");
    }
    expect(result.type).toBe(CheckoutClient);
    expect(result.props.initialData).toEqual(initialData);
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
    expect(loadCheckoutPageData).not.toHaveBeenCalled();
  });

  it("fails closed when safe checkout page data cannot load", async () => {
    jest.mocked(loadCheckoutPageAccess).mockResolvedValue({ open: true });
    jest
      .mocked(loadCheckoutPageData)
      .mockRejectedValue(new Error("square_configuration_invalid"));

    const result = await CheckoutPage();

    expect(result.type).toBe(CheckoutUnavailable);
  });
});
