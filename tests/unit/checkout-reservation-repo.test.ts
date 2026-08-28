import { CheckoutReservationRepository } from "@/repositories/checkout-reservation-repo";

describe("CheckoutReservationRepository", () => {
  it("passes integer money and purchase snapshots to the atomic reservation RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: {
        order_id: "order-1",
        reused: false,
        expires_at: "2026-08-26T18:15:00.000Z",
      },
      error: null,
    });
    const repo = new CheckoutReservationRepository({ rpc } as never);

    await expect(
      repo.reserve({
        tenantId: "tenant-1",
        userId: null,
        guestEmail: "buyer@example.com",
        fulfillment: "ship",
        idempotencyKey: "idem-1",
        cartHash: "cart-hash",
        expiresAt: new Date("2026-08-26T18:15:00.000Z"),
        subtotalCents: 12500,
        shippingCents: 1500,
        taxCents: 980,
        totalCents: 14980,
        protectionEvidence: { bot: "passed", maskedIp: "203.0.113.x" },
        items: [
          {
            productId: "product-1",
            variantId: "variant-1",
            quantity: 1,
            unitPriceCents: 12500,
            unitCostCents: 7000,
            lineTotalCents: 12500,
            variantSku: "SKU-1",
            productName: "Dunk Low",
            brand: "Nike",
            model: "Dunk",
            category: "shoes",
            condition: "new",
            sizeLabel: "10",
          },
        ],
      }),
    ).resolves.toEqual({
      orderId: "order-1",
      reused: false,
      expiresAt: "2026-08-26T18:15:00.000Z",
      squarePaymentLinkId: null,
      squareOrderId: null,
      squarePaymentLinkUrl: null,
    });

    expect(rpc).toHaveBeenCalledWith(
      "reserve_square_checkout_inventory",
      expect.objectContaining({
        p_subtotal_cents: 12500,
        p_shipping_cents: 1500,
        p_tax_cents: 980,
        p_total_cents: 14980,
        p_items: [
          expect.objectContaining({
            product_id: "product-1",
            variant_id: "variant-1",
            line_total_cents: 12500,
          }),
        ],
      }),
    );
  });

  it("rejects a malformed reservation response", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: { reused: false }, error: null });
    const repo = new CheckoutReservationRepository({ rpc } as never);

    await expect(
      repo.reserve({
        tenantId: "tenant-1",
        userId: null,
        guestEmail: "buyer@example.com",
        fulfillment: "pickup",
        idempotencyKey: "idem-1",
        cartHash: "cart-hash",
        expiresAt: new Date("2026-08-26T18:15:00.000Z"),
        subtotalCents: 1000,
        shippingCents: 0,
        taxCents: 0,
        totalCents: 1000,
        protectionEvidence: {},
        items: [],
      }),
    ).rejects.toThrow("checkout_reservation_invalid_response");
  });

  it("persists Square identifiers only through the guarded RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null });
    const repo = new CheckoutReservationRepository({ rpc } as never);

    await expect(
      repo.attachPaymentLink("order-1", {
        id: "link-1",
        orderId: "square-order-1",
        url: "https://square.link/u/example",
      }),
    ).resolves.toBeUndefined();

    expect(rpc).toHaveBeenCalledWith("attach_square_payment_link", {
      p_order_id: "order-1",
      p_square_order_id: "square-order-1",
      p_square_payment_link_id: "link-1",
      p_square_payment_link_url: "https://square.link/u/example",
    });
  });
});
