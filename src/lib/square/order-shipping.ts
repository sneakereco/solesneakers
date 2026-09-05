import type { SquareClient } from "square";

import type { AddressInput } from "@/repositories/addresses-repo";

type SquareOrdersReader = Pick<SquareClient["orders"], "get">;

export class SquareOrderShippingReader {
  constructor(private readonly orders: SquareOrdersReader) {}

  async get(squareOrderId: string): Promise<AddressInput | null> {
    const response = await this.orders.get({ orderId: squareOrderId });
    const recipient = response.order?.fulfillments?.find(
      (fulfillment) => fulfillment.type === "SHIPMENT",
    )?.shipmentDetails?.recipient;
    const address = recipient?.address;

    if (
      !address?.addressLine1 ||
      !address.locality ||
      !address.administrativeDistrictLevel1 ||
      !address.postalCode ||
      !address.country
    ) {
      return null;
    }

    return {
      name: recipient?.displayName ?? null,
      phone: recipient?.phoneNumber ?? null,
      line1: address.addressLine1,
      line2: address.addressLine2 ?? null,
      city: address.locality,
      state: address.administrativeDistrictLevel1,
      postalCode: address.postalCode,
      country: String(address.country),
    };
  }
}
