import { assertShippingLabelPurchaseAllowed } from "@/lib/shipping/label-purchase-policy";
import type { ShippingLabelPolicyError } from "@/lib/shipping/label-purchase-policy";

const ready = {
  order: {
    status: "paid",
    fulfillment: "ship",
    fulfillment_status: "unfulfilled",
    tracking_number: null,
    label_url: null,
    label_created_at: null,
  },
  shipping: { square_synced_at: "2026-09-05T12:00:00.000Z" },
  rate: { carrier: "USPS", shipmentId: "shipment-1" },
  submittedShipmentId: "shipment-1",
  enabledCarriers: ["USPS"] as const,
};

describe("assertShippingLabelPurchaseAllowed", () => {
  it("allows a paid shipping order with a Square-synced address and enabled rate", () => {
    expect(() => assertShippingLabelPurchaseAllowed(ready)).not.toThrow();
  });

  it.each(["pending", "review", "refunded", "canceled"])(
    "blocks an order with status %s",
    (status) => {
      expect(() =>
        assertShippingLabelPurchaseAllowed({
          ...ready,
          order: { ...ready.order, status },
        }),
      ).toThrow(
        expect.objectContaining<Partial<ShippingLabelPolicyError>>({
          code: "shipping_order_not_fulfillment_ready",
          status: 409,
        }),
      );
    },
  );

  it("blocks an order that already has label evidence", () => {
    expect(() =>
      assertShippingLabelPurchaseAllowed({
        ...ready,
        order: { ...ready.order, tracking_number: "tracking-1" },
      }),
    ).toThrow(
      expect.objectContaining<Partial<ShippingLabelPolicyError>>({
        code: "shipping_label_already_purchased",
        status: 409,
      }),
    );
  });

  it("blocks an address that was not synchronized from Square", () => {
    expect(() =>
      assertShippingLabelPurchaseAllowed({ ...ready, shipping: null }),
    ).toThrow(
      expect.objectContaining<Partial<ShippingLabelPolicyError>>({
        code: "shipping_address_not_square_synced",
        status: 400,
      }),
    );
  });

  it("blocks a rate from a different shipment", () => {
    expect(() =>
      assertShippingLabelPurchaseAllowed({
        ...ready,
        rate: { ...ready.rate, shipmentId: "shipment-2" },
      }),
    ).toThrow(
      expect.objectContaining<Partial<ShippingLabelPolicyError>>({
        code: "shipping_rate_shipment_mismatch",
        status: 400,
      }),
    );
  });

  it("blocks a rate from a disabled carrier", () => {
    expect(() =>
      assertShippingLabelPurchaseAllowed({
        ...ready,
        rate: { ...ready.rate, carrier: "UPS" },
      }),
    ).toThrow(
      expect.objectContaining<Partial<ShippingLabelPolicyError>>({
        code: "shipping_carrier_disabled",
        status: 400,
      }),
    );
  });
});
