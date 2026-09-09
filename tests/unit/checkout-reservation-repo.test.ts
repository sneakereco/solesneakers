import { CheckoutReservationRepository } from "@/repositories/checkout-reservation-repo";

describe("CheckoutReservationRepository", () => {
  it("lists only pending expired checkouts for the reaper", async () => {
    const limit = jest.fn().mockResolvedValue({
      data: [
        {
          id: "order-1",
          square_payment_link_id: "link-1",
          square_payment_link_deleted_at: null,
          square_order_id: "square-order-1",
          square_order_version: 4,
        },
      ],
      error: null,
    });
    const order = jest.fn(() => ({ limit }));
    const lte = jest.fn(() => ({ order }));
    const eq = jest.fn(() => ({ lte }));
    const select = jest.fn(() => ({ eq }));
    const repository = new CheckoutReservationRepository({
      from: jest.fn(() => ({ select })),
    } as never);

    const result = await repository.listExpired("2026-08-28T03:00:00.000Z", 25);

    expect(result).toEqual([
      {
        orderId: "order-1",
        squarePaymentLinkId: "link-1",
        squarePaymentLinkDeletedAt: null,
        squareOrderId: "square-order-1",
        squareOrderVersion: 4,
      },
    ]);
    expect(eq).toHaveBeenCalledWith("status", "pending");
    expect(lte).toHaveBeenCalledWith("expires_at", "2026-08-28T03:00:00.000Z");
    expect(limit).toHaveBeenCalledWith(25);
  });

  it("loads an existing checkout by tenant and idempotency key", async () => {
    const maybeSingle = jest.fn().mockResolvedValue({
      data: {
        id: "order-1",
        cart_hash: "cart-hash",
        status: "pending",
        expires_at: "2026-08-28T03:00:00.000Z",
        subtotal: 150,
        shipping: 12,
        tax_amount: 9,
        total: 171,
        fulfillment: "ship",
        guest_email: "buyer@example.com",
        square_payment_link_id: "link-1",
        square_order_id: "square-order-1",
        square_order_version: 1,
        square_payment_link_url: "https://square.link/u/example",
        square_payment_link_deleted_at: null,
        order_items: [],
      },
      error: null,
    });
    const eqIdempotency = jest.fn(() => ({ maybeSingle }));
    const eqTenant = jest.fn(() => ({ eq: eqIdempotency }));
    const select = jest.fn(() => ({ eq: eqTenant }));
    const supabase = { from: jest.fn(() => ({ select })) };
    const repository = new CheckoutReservationRepository(supabase as never);

    const result = await repository.findByIdempotencyKey("tenant-1", "key-1");

    expect(result).toEqual(
      expect.objectContaining({
        orderId: "order-1",
        cartHash: "cart-hash",
        subtotalCents: 15000,
        shippingCents: 1200,
        taxCents: 900,
        totalCents: 17100,
      }),
    );
    expect(eqTenant).toHaveBeenCalledWith("tenant_id", "tenant-1");
    expect(eqIdempotency).toHaveBeenCalledWith("idempotency_key", "key-1");
  });

  it.each(["object", "array"])(
    "loads a payment checkout with %s billing",
    async (shape) => {
      const maybeSingle = jest.fn().mockResolvedValue({
        data: {
          id: "order-1",
          tenant_id: "tenant-1",
          user_id: null,
          guest_email: "buyer@example.com",
          cart_hash: "cart-hash",
          status: "pending",
          expires_at: "2026-09-06T12:15:00.000Z",
          subtotal: 100,
          shipping: 10,
          tax_amount: 8,
          total: 118,
          fulfillment: "ship",
          square_order_id: "square-order-1",
          square_order_version: 2,
          checkout_protection_evidence: { device_session_id: "device-1" },
          order_billing: {
            line1: "2 Billing Street",
            line2: null,
            city: "Charleston",
            state: "SC",
            postal_code: "29402",
            country: "US",
          },
          order_shipping: {
            name: "Buyer",
            phone: "5555555555",
            line1: "1 Main Street",
            line2: null,
            city: "Charleston",
            state: "SC",
            postal_code: "29401",
            country: "US",
          },
        },
        error: null,
      });
      const eq = jest.fn(() => ({ maybeSingle }));
      const select = jest.fn(() => ({ eq }));
      const repository = new CheckoutReservationRepository({
        from: jest.fn(() => ({ select })),
      } as never);

      const response = await maybeSingle();
      const billing = response.data.order_billing;
      if (shape === "array") {
        maybeSingle.mockResolvedValue({
          ...response,
          data: { ...response.data, order_billing: [billing] },
        });
      }

      await expect(repository.findPaymentCheckout("order-1")).resolves.toEqual(
        expect.objectContaining({
          orderId: "order-1",
          tenantId: "tenant-1",
          deviceSessionId: "device-1",
          squareOrderVersion: 2,
          totalCents: 11800,
          shippingAddress: expect.objectContaining({ postalCode: "29401" }),
          billingAddress: expect.objectContaining({ postalCode: "29402" }),
        }),
      );
      expect(eq).toHaveBeenCalledWith("id", "order-1");
      maybeSingle.mockResolvedValue({
        ...response,
        data: { ...response.data, order_billing: [billing, billing] },
      });
      await expect(repository.findPaymentCheckout("order-1")).rejects.toThrow(
        "checkout_payment_order_invalid",
      );
      maybeSingle.mockResolvedValue({
        ...response,
        data: { ...response.data, order_billing: [] },
      });
      await expect(repository.findPaymentCheckout("order-1")).resolves.toMatchObject({
        billingAddress: null,
      });
    },
  );

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
        paymentMethod: "card",
        idempotencyKey: "idem-1",
        cartHash: "cart-hash",
        expiresAt: new Date("2026-08-26T18:15:00.000Z"),
        subtotalCents: 12500,
        shippingCents: 1500,
        taxCents: 980,
        totalCents: 14980,
        taxCalculationId: "tax-calc-1",
        customerState: "SC",
        shippingAddress: {
          name: "Buyer",
          phone: null,
          line1: "1 Main Street",
          line2: null,
          city: "Charleston",
          state: "SC",
          postalCode: "29401",
          country: "US",
        },
        billingAddress: {
          givenName: "Buyer",
          familyName: "Example",
          phone: null,
          line1: "1 Billing Street",
          line2: null,
          city: "Charleston",
          state: "SC",
          postalCode: "29401",
          country: "US",
        },
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
        p_tax_calculation_id: "tax-calc-1",
        p_customer_state: "SC",
        p_payment_method: "card",
        p_shipping_address: expect.objectContaining({
          postal_code: "29401",
          country: "US",
        }),
        p_billing_address: expect.objectContaining({
          given_name: "Buyer",
          family_name: "Example",
          postal_code: "29401",
          country: "US",
        }),
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
        paymentMethod: "applePay",
        idempotencyKey: "idem-1",
        cartHash: "cart-hash",
        expiresAt: new Date("2026-08-26T18:15:00.000Z"),
        subtotalCents: 1000,
        shippingCents: 0,
        taxCents: 0,
        totalCents: 1000,
        taxCalculationId: "tax-calc-2",
        customerState: "SC",
        shippingAddress: null,
        billingAddress: null,
        protectionEvidence: {},
        items: [],
      }),
    ).rejects.toThrow("checkout_reservation_invalid_response");
  });

  it("attaches a direct Square order and its authoritative totals", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null });
    const repo = new CheckoutReservationRepository({ rpc } as never);

    await expect(
      repo.attachSquareOrder("order-1", {
        id: "square-order-1",
        version: 2,
        subtotalCents: 15000,
        shippingCents: 1200,
        taxCents: 900,
        totalCents: 17100,
        taxCalculationId: "square:square-order-1:v2",
      }),
    ).resolves.toBeUndefined();

    expect(rpc).toHaveBeenCalledWith("attach_square_checkout_order", {
      p_order_id: "order-1",
      p_square_order_id: "square-order-1",
      p_square_order_version: 2,
      p_shipping_cents: 1200,
      p_tax_cents: 900,
      p_total_cents: 17100,
      p_tax_calculation_id: "square:square-order-1:v2",
    });
  });
});
