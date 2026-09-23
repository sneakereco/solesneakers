import { enteredStorefront, hasUsableCheckout } from "@/lib/measurement/triggers";

describe("storefront route entry", () => {
  it("counts direct /store entry and re-entry, not the landing page or same-route updates", () => {
    expect(enteredStorefront(null, "/")).toBe(false);
    expect(enteredStorefront(null, "/store")).toBe(true);
    expect(enteredStorefront("/", "/store")).toBe(true);
    expect(enteredStorefront("/store", "/store")).toBe(false);
    expect(
      enteredStorefront("/store", "/store/123e4567-e89b-42d3-a456-426614174000"),
    ).toBe(false);
    expect(
      enteredStorefront("/store/123e4567-e89b-42d3-a456-426614174000", "/store"),
    ).toBe(true);
  });
});

describe("usable checkout entry", () => {
  it("waits for a ready, nonempty cart and excludes the redirect/payment state", () => {
    expect(
      hasUsableCheckout({ cartReady: false, itemCount: 1, isRedirecting: false }),
    ).toBe(false);
    expect(
      hasUsableCheckout({ cartReady: true, itemCount: 0, isRedirecting: false }),
    ).toBe(false);
    expect(
      hasUsableCheckout({ cartReady: true, itemCount: 1, isRedirecting: true }),
    ).toBe(false);
    expect(
      hasUsableCheckout({ cartReady: true, itemCount: 1, isRedirecting: false }),
    ).toBe(true);
  });
});
