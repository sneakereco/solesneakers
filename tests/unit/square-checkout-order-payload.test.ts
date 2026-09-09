import {
  buildSquareCheckoutOrder,
  readSquareCheckoutTotals,
} from "@/lib/square/checkout-order-payload";

const item = {
  productId: "product-1",
  variantId: "variant-1",
  quantity: 1,
  unitPriceCents: 25_000,
  unitCostCents: 15_000,
  lineTotalCents: 25_000,
  variantSku: "SKU-1",
  productName: "Air Runner",
  brand: "Sole",
  model: "One",
  category: "shoes",
  condition: "new",
  sizeLabel: "10",
};

describe("Square checkout order payload", () => {
  it("builds a tax quote from a redacted wallet destination", () => {
    const order = buildSquareCheckoutOrder("LOCATION", {
      fulfillment: "ship",
      subtotalCents: 25_000,
      shippingCents: 1_500,
      shippingAddress: {
        state: "DE",
        postalCode: "19801",
        country: "US",
      },
      items: [item],
    });

    expect(order.fulfillments).toBeUndefined();
  });

  it("builds the final shipment contract from server prices", () => {
    expect(
      buildSquareCheckoutOrder("LOCATION", {
        referenceId: "local-order-1",
        fulfillment: "ship",
        buyerEmail: "buyer@example.com",
        subtotalCents: 25_000,
        shippingCents: 1_500,
        shippingAddress: {
          name: "Buyer Example",
          phone: "8435550100",
          line1: "1 Main Street",
          line2: null,
          city: "Charleston",
          state: "SC",
          postalCode: "29401",
          country: "US",
        },
        items: [item],
      }),
    ).toEqual({
      locationId: "LOCATION",
      referenceId: "local-order-1",
      lineItems: [
        {
          name: "Air Runner - 10",
          quantity: "1",
          note: "SKU SKU-1",
          basePriceMoney: { amount: BigInt(25_000), currency: "USD" },
        },
      ],
      serviceCharges: [
        {
          name: "Shipping",
          amountMoney: { amount: BigInt(1_500), currency: "USD" },
          calculationPhase: "SUBTOTAL_PHASE",
          taxable: true,
        },
      ],
      fulfillments: [
        {
          type: "SHIPMENT",
          state: "PROPOSED",
          shipmentDetails: {
            recipient: {
              displayName: "Buyer Example",
              emailAddress: "buyer@example.com",
              phoneNumber: "8435550100",
              address: {
                addressLine1: "1 Main Street",
                addressLine2: undefined,
                locality: "Charleston",
                administrativeDistrictLevel1: "SC",
                postalCode: "29401",
                country: "US",
              },
            },
          },
        },
      ],
      pricingOptions: { autoApplyTaxes: true, autoApplyDiscounts: false },
    });
  });

  it("builds ASAP pickup without a shipping charge", () => {
    const order = buildSquareCheckoutOrder("LOCATION", {
      fulfillment: "pickup",
      subtotalCents: 25_000,
      shippingCents: 0,
      shippingAddress: null,
      items: [item],
    });

    expect(order.serviceCharges).toBeUndefined();
    expect(order.fulfillments).toEqual([
      {
        type: "PICKUP",
        state: "PROPOSED",
        pickupDetails: { scheduleType: "ASAP", prepTimeDuration: "PT0S" },
      },
    ]);
  });

  it("rejects a subtotal that differs from its line items", () => {
    expect(() =>
      buildSquareCheckoutOrder("LOCATION", {
        fulfillment: "pickup",
        subtotalCents: 24_999,
        shippingCents: 0,
        shippingAddress: null,
        items: [item],
      }),
    ).toThrow("square_checkout_order_subtotal_mismatch");
  });

  it("reads and reconciles calculated Square totals", () => {
    expect(
      readSquareCheckoutTotals(
        {
          locationId: "LOCATION",
          totalMoney: { amount: BigInt(28_563), currency: "USD" },
          totalTaxMoney: { amount: BigInt(2_063), currency: "USD" },
          totalServiceChargeMoney: { amount: BigInt(1_500), currency: "USD" },
        },
        25_000,
        1_500,
      ),
    ).toEqual({
      subtotalCents: 25_000,
      shippingCents: 1_500,
      taxCents: 2_063,
      totalCents: 28_563,
    });
  });
});
