import { renderToStaticMarkup } from "react-dom/server";

import {
  assertWalletTotalUnchanged,
  bindWalletShippingContact,
  SquarePaymentMethods,
  turnstileErrorMessage,
  walletPaymentTotal,
  walletShippingAddress,
} from "@/components/checkout/SquarePaymentMethods";

const paymentConfig = {
  applicationId: "sandbox-app",
  locationId: "location-1",
  environment: "sandbox" as const,
};

describe("SquarePaymentMethods", () => {
  it("blocks prepare when the final address changes the wallet-approved total", () => {
    const displayed = {
      completeness: "exact" as const,
      quoteFingerprint: "a".repeat(64),
      totals: {
        subtotalCents: 10_000,
        shippingCents: 1_000,
        taxCents: 800,
        totalCents: 11_800,
      },
    };
    const changed = {
      ...displayed,
      quoteFingerprint: "b".repeat(64),
      totals: { ...displayed.totals, taxCents: 900, totalCents: 11_900 },
    };

    expect(() => assertWalletTotalUnchanged(displayed, changed)).toThrow(
      "Your total changed. Review the updated checkout and retry.",
    );
    expect(() => assertWalletTotalUnchanged(displayed, displayed)).not.toThrow();
  });

  it("requotes the wallet shipping contact and returns exact totals to Square", async () => {
    let listener:
      | ((value: unknown) => Record<string, unknown> | Promise<Record<string, unknown>>)
      | undefined;
    const request = {
      addEventListener: jest.fn(
        (
          event: string,
          next: (
            value: unknown,
          ) => Record<string, unknown> | Promise<Record<string, unknown>>,
        ) => {
          if (event === "shippingcontactchanged") {
            listener = next;
          }
        },
      ),
    };
    const exactQuote = {
      completeness: "exact" as const,
      quoteFingerprint: "a".repeat(64),
      totals: {
        subtotalCents: 10_000,
        shippingCents: 1_000,
        taxCents: 800,
        totalCents: 11_800,
      },
    };
    const resolveWalletShippingContact = jest.fn().mockResolvedValue({
      quote: exactQuote,
      shippingAddress: {
        name: "Ada Lovelace",
        phone: "3025550100",
        line1: "1 Market St",
        line2: null,
        city: "Wilmington",
        state: "DE",
        postalCode: "19801",
        country: "US",
      },
    });

    bindWalletShippingContact(request, resolveWalletShippingContact);

    expect(listener).toBeDefined();
    await expect(
      listener?.({
        state: "DE",
        postalCode: "19801",
        countryCode: "US",
      }),
    ).resolves.toEqual({
      shippingOptions: [
        {
          id: "STANDARD",
          label: "Standard shipping",
          amount: "10.00",
          taxLineItems: [{ label: "Tax", amount: "8.00" }],
          total: { label: "Total", amount: "118.00" },
        },
      ],
    });
    expect(resolveWalletShippingContact).toHaveBeenCalledWith({
      state: "DE",
      postalCode: "19801",
      country: "US",
    });
  });

  it("uses a preliminary server quote to initialize express wallets", () => {
    expect(
      walletPaymentTotal({
        completeness: "preliminary",
        quoteFingerprint: null,
        totals: {
          subtotalCents: 10_000,
          shippingCents: 1_000,
          taxCents: null,
          totalCents: 11_000,
        },
      }),
    ).toEqual({ amount: "110.00", label: "Estimated total", pending: true });
  });

  it("normalizes a complete wallet shipping contact for an exact quote", () => {
    expect(
      walletShippingAddress({
        givenName: "Ada",
        familyName: "Lovelace",
        phone: "3025550100",
        addressLines: ["1 Market St", "Suite 2"],
        city: "Wilmington",
        state: "de",
        postalCode: "19801",
        countryCode: "US",
      }),
    ).toEqual({
      name: "Ada Lovelace",
      phone: "3025550100",
      line1: "1 Market St",
      line2: "Suite 2",
      city: "Wilmington",
      state: "DE",
      postalCode: "19801",
      country: "US",
    });
  });

  it("identifies an unauthorized Turnstile hostname as terminal configuration", () => {
    expect(turnstileErrorMessage("110200")).toBe(
      "Guest verification is not configured for this checkout hostname.",
    );
    expect(turnstileErrorMessage("110600")).toBeNull();
  });

  it("renders express, card, Afterpay, and guest verification surfaces immediately", () => {
    const html = renderToStaticMarkup(
      <SquarePaymentMethods
        paymentConfig={paymentConfig}
        quote={null}
        fulfillment="ship"
        buyerEmail=""
        shippingAddress={null}
        isGuest
        quoteWalletShippingDestination={jest.fn()}
        resolveWalletShippingContact={jest.fn()}
        prepare={jest.fn()}
        clearCart={jest.fn()}
      />,
    );

    expect(html).toContain('id="square-apple-pay-container"');
    expect(html).toContain('id="square-google-pay-container"');
    expect(html).toContain('id="square-cash-app-pay-container"');
    expect(html).toContain('id="square-card-container"');
    expect(html).toContain('id="square-afterpay-container"');
    expect(html).toContain("Calculated after address");
    expect(html).toContain("Pay now");
  });

  it("renders an exact card total without marketing payment options", () => {
    const html = renderToStaticMarkup(
      <SquarePaymentMethods
        paymentConfig={paymentConfig}
        quote={{
          completeness: "exact",
          quoteFingerprint: "a".repeat(64),
          totals: {
            subtotalCents: 10_000,
            shippingCents: 1_000,
            taxCents: 800,
            totalCents: 11_800,
          },
        }}
        fulfillment="pickup"
        buyerEmail="buyer@example.com"
        shippingAddress={null}
        isGuest={false}
        quoteWalletShippingDestination={jest.fn()}
        resolveWalletShippingContact={jest.fn()}
        prepare={jest.fn()}
        clearCart={jest.fn()}
      />,
    );

    expect(html).toContain("Pay $118.00 now");
    expect(html).not.toContain("PayPal");
    expect(html).not.toContain("Klarna");
    expect(html).not.toContain("Venmo");
  });
});
