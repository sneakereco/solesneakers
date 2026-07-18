import { CheckoutUnavailable } from "@/components/checkout/CheckoutUnavailable";

import CheckoutPage from "../../app/checkout/page";

describe("app/checkout/page", () => {
  it("renders the unavailable state while no payment provider is configured", () => {
    const result = CheckoutPage();

    expect(result.type).toBe(CheckoutUnavailable);
  });
});
