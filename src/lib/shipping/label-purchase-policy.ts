import { normalizeCarrier, type CarrierKey } from "@/lib/shipping/carriers";

export type ShippingLabelPolicyCode =
  | "shipping_order_not_fulfillment_ready"
  | "shipping_label_already_purchased"
  | "shipping_address_not_square_synced"
  | "shipping_rate_shipment_mismatch"
  | "shipping_carrier_disabled";

export class ShippingLabelPolicyError extends Error {
  constructor(
    public readonly code: ShippingLabelPolicyCode,
    public readonly status: 400 | 409,
  ) {
    super(code);
    this.name = "ShippingLabelPolicyError";
  }
}

type LabelOrder = {
  status?: string | null;
  fulfillment?: string | null;
  fulfillment_status?: string | null;
  tracking_number?: string | null;
  label_url?: string | null;
  label_created_at?: string | null;
};

type LabelShipping = { square_synced_at?: string | null };
type LabelRate = { carrier: string; shipmentId: string };

export function assertOrderReadyForLabel(
  order: LabelOrder,
  shipping: LabelShipping | null,
): void {
  const fulfillmentStatus = String(order.fulfillment_status ?? "").toLowerCase();
  if (
    order.tracking_number ||
    order.label_url ||
    order.label_created_at ||
    ["ready_to_ship", "shipped", "delivered"].includes(fulfillmentStatus)
  ) {
    throw new ShippingLabelPolicyError("shipping_label_already_purchased", 409);
  }

  if (order.status !== "paid" || order.fulfillment !== "ship") {
    throw new ShippingLabelPolicyError(
      "shipping_order_not_fulfillment_ready",
      409,
    );
  }

  if (!shipping?.square_synced_at) {
    throw new ShippingLabelPolicyError("shipping_address_not_square_synced", 400);
  }
}

export function assertRateAllowed(
  rate: LabelRate,
  submittedShipmentId: string,
  enabledCarriers: readonly CarrierKey[],
): void {
  if (rate.shipmentId !== submittedShipmentId) {
    throw new ShippingLabelPolicyError("shipping_rate_shipment_mismatch", 400);
  }

  const carrier = normalizeCarrier(rate.carrier);
  if (!carrier || !enabledCarriers.includes(carrier)) {
    throw new ShippingLabelPolicyError("shipping_carrier_disabled", 400);
  }
}

export function assertShippingLabelPurchaseAllowed(input: {
  order: LabelOrder;
  shipping: LabelShipping | null;
  rate: LabelRate;
  submittedShipmentId: string;
  enabledCarriers: readonly CarrierKey[];
}): void {
  assertOrderReadyForLabel(input.order, input.shipping);
  assertRateAllowed(input.rate, input.submittedShipmentId, input.enabledCarriers);
}
