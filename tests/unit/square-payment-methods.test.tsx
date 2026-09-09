import { renderToStaticMarkup } from "react-dom/server";

import {
  assertWalletTotalUnchanged,
  bindWalletShippingContact,
  initializePaymentMethodsConcurrently,
  resolveBillingAddress,
  squareBillingContact,
  SquarePaymentMethods,
  turnstileErrorMessage,
  walletBillingAddress,
  walletPaymentTotal,
  walletShippingAddress,
} from "@/components/checkout/SquarePaymentMethods";
import { squareCardStyle } from "@/components/checkout/square-card-style";
import { initializeSquareCard } from "@/components/checkout/square-card-initialization";

const paymentConfig = {
  applicationId: "sandbox-app",
  locationId: "location-1",
  environment: "sandbox" as const,
};

describe("SquarePaymentMethods", () => {
  it("builds Square verification contact from cardholder and billing data", () => {
    expect(
      squareBillingContact({
        cardholderName: "Ada Lovelace",
        buyerEmail: "ada@example.com",
        billingAddress: {
          givenName: "Billing",
          familyName: "Recipient",
          phone: null,
          line1: "1 Billing Street",
          line2: null,
          city: "Charleston",
          state: "SC",
          postalCode: "29401",
          country: "US",
        },
      }),
    ).toEqual({
      givenName: "Ada",
      familyName: "Lovelace",
      email: "ada@example.com",
      phone: undefined,
      addressLines: ["1 Billing Street"],
      city: "Charleston",
      state: "SC",
      postalCode: "29401",
      countryCode: "US",
    });
  });

  it("resolves shipping and pickup billing without accepting partial data", () => {
    const shippingAddress = {
      name: "Ada Lovelace",
      phone: "3025550100",
      line1: "1 Market St",
      line2: null,
      city: "Wilmington",
      state: "DE",
      postalCode: "19801",
      country: "US" as const,
    };
    const billingAddress = {
      givenName: "Grace",
      familyName: "Hopper",
      phone: "2125550100",
      line1: "1 Billing St",
      line2: "Suite 2",
      city: "New York",
      state: "NY",
      postalCode: "10001",
      country: "US",
    };

    expect(
      resolveBillingAddress({
        fulfillment: "ship",
        sameAsShipping: true,
        shippingAddress,
        billingAddress,
      }),
    ).toEqual({
      givenName: "Ada",
      familyName: "Lovelace",
      phone: "3025550100",
      line1: "1 Market St",
      line2: null,
      city: "Wilmington",
      state: "DE",
      postalCode: "19801",
      country: "US",
    });
    expect(
      resolveBillingAddress({
        fulfillment: "pickup",
        sameAsShipping: true,
        shippingAddress: null,
        billingAddress,
      }),
    ).toEqual({ ...billingAddress, country: "US" });
    expect(
      resolveBillingAddress({
        fulfillment: "pickup",
        sameAsShipping: false,
        shippingAddress: null,
        billingAddress: { ...billingAddress, postalCode: "" },
      }),
    ).toBeNull();
  });

  it("uses supported Square selectors for the checkout card style", () => {
    expect(squareCardStyle[".input-container"]).toEqual({
      borderColor: "#dedede",
      borderRadius: "12px",
      borderWidth: "1px",
    });
    expect(squareCardStyle[".input-container.is-focus"]).toEqual({
      borderColor: "#1878b9",
      borderWidth: "1px",
    });
    expect(squareCardStyle[".input-container.is-error"]).toEqual({
      borderColor: "#b45309",
      borderWidth: "1px",
    });
    expect(JSON.stringify(squareCardStyle)).not.toContain("boxShadow");
    expect(squareCardStyle.input).toEqual(expect.objectContaining({ fontSize: "16px" }));
    expect(squareCardStyle["input::placeholder"]).toEqual({ color: "#737373" });
  });

  it("publishes Square Payments before a card attachment failure", async () => {
    const attachError = new Error("card attach failed");
    const payments = {
      card: jest.fn().mockResolvedValue({
        attach: jest.fn().mockRejectedValue(attachError),
        tokenize: jest.fn(),
      }),
    };
    const onPaymentsReady = jest.fn();

    await expect(initializeSquareCard(payments, onPaymentsReady)).rejects.toBe(
      attachError,
    );
    expect(onPaymentsReady).toHaveBeenCalledWith(payments);
  });

  it("starts optional payment methods independently", async () => {
    const started: string[] = [];
    let finishApplePay: (() => void) | undefined;
    const pending = initializePaymentMethodsConcurrently([
      () =>
        new Promise<void>((resolve) => {
          started.push("applePay");
          finishApplePay = resolve;
        }),
      () => {
        started.push("googlePay");
        return Promise.resolve();
      },
    ]);

    expect(started).toEqual(["applePay", "googlePay"]);
    finishApplePay?.();
    await pending;
  });

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

  it("normalizes a complete wallet billing contact for the order snapshot", () => {
    expect(
      walletBillingAddress({
        givenName: "Ada",
        familyName: "Lovelace",
        phone: "3025550100",
        addressLines: ["1 Billing St", "Suite 2"],
        city: "Wilmington",
        state: "de",
        postalCode: "19801",
        countryCode: "US",
      }),
    ).toEqual({
      givenName: "Ada",
      familyName: "Lovelace",
      phone: "3025550100",
      line1: "1 Billing St",
      line2: "Suite 2",
      city: "Wilmington",
      state: "DE",
      postalCode: "19801",
      country: "US",
    });
    expect(walletBillingAddress({ postalCode: "19801", countryCode: "US" })).toBeNull();
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
    expect(html).toContain('id="checkout-turnstile-container"');
    expect(html).toContain('role="radiogroup"');
    expect(html).not.toMatch(/aria-label="(?:Visa|Mastercard|American Express)"/);
    expect(html).not.toContain("+5");
    expect(html).toContain("Use shipping address as billing address");
    expect(html.indexOf("Credit card")).toBeLessThan(html.indexOf("Afterpay"));
    expect(html).not.toContain("Shipping and tax are calculated in your wallet.");
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
    expect(html).toContain("Billing address");
    expect(html).toContain('autoComplete="billing given-name"');
    expect(html).not.toContain("PayPal");
    expect(html).not.toContain("Klarna");
    expect(html).not.toContain("Venmo");
    expect(html).not.toContain('id="checkout-turnstile-container"');
  });
});
