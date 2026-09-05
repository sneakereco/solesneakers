jest.mock("@/lib/auth/session", () => ({
  requireAdminApi: jest.fn(),
}));

jest.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: jest.fn(),
}));

jest.mock("@/repositories/orders-repo", () => ({
  OrdersRepository: jest.fn(),
}));

jest.mock("@/repositories/addresses-repo", () => ({
  AddressesRepository: jest.fn(),
}));

jest.mock("@/repositories/shipping-carriers-repo", () => ({
  ShippingCarriersRepository: jest.fn(),
}));

jest.mock("@/repositories/profile-repo", () => ({
  ProfileRepository: jest.fn(() => ({ getByUserId: jest.fn() })),
}));

jest.mock("@/services/order-access-token-service", () => ({
  OrderAccessTokenService: jest.fn(() => ({ createToken: jest.fn() })),
}));

jest.mock("@/services/shipping-label-service", () => ({
  ShippoService: jest.fn(),
}));

import { requireAdminApi } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AddressesRepository } from "@/repositories/addresses-repo";
import { OrdersRepository } from "@/repositories/orders-repo";
import { ShippingCarriersRepository } from "@/repositories/shipping-carriers-repo";
import { ShippoService } from "@/services/shipping-label-service";
import { POST } from "../../app/api/admin/shipping/labels/route";

const mockRequireAdminApi = jest.mocked(requireAdminApi);
const mockCreateSupabaseServerClient = jest.mocked(createSupabaseServerClient);
const mockGetOrder = jest.fn();
const mockMarkReadyToShip = jest.fn();
const mockGetShipping = jest.fn();
const mockGetCarriers = jest.fn();
const mockGetRate = jest.fn();
const mockPurchaseLabel = jest.fn();

const orderId = "11111111-1111-4111-8111-111111111111";

function request(): Parameters<typeof POST>[0] {
  return new Request("https://shop.example.com/api/admin/shipping/labels", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      orderId,
      shipmentId: "shipment-1",
      rateId: "rate-1",
    }),
  }) as Parameters<typeof POST>[0];
}

describe("POST /api/admin/shipping/labels", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(OrdersRepository).mockImplementation(
      () =>
        ({
          getById: mockGetOrder,
          markReadyToShip: mockMarkReadyToShip,
        }) as never,
    );
    jest.mocked(AddressesRepository).mockImplementation(
      () => ({ getOrderShipping: mockGetShipping }) as never,
    );
    jest.mocked(ShippingCarriersRepository).mockImplementation(
      () => ({ get: mockGetCarriers }) as never,
    );
    jest.mocked(ShippoService).mockImplementation(
      () => ({ getRate: mockGetRate, purchaseLabel: mockPurchaseLabel }) as never,
    );
    mockRequireAdminApi.mockResolvedValue({
      profile: {
        id: "admin-1",
        email: "admin@example.com",
        role: "admin",
        full_name: null,
        tenant_id: null,
      },
    } as never);
    mockCreateSupabaseServerClient.mockResolvedValue({} as never);
    mockGetOrder.mockResolvedValue({
      id: orderId,
      status: "paid",
      fulfillment: "ship",
      fulfillment_status: "unfulfilled",
      tracking_number: null,
      label_url: null,
      label_created_at: null,
      user_id: null,
      guest_email: null,
    });
    mockGetShipping.mockResolvedValue({
      order_id: orderId,
      square_synced_at: "2026-09-05T12:00:00.000Z",
    });
    mockGetCarriers.mockResolvedValue({ enabled_carriers: ["USPS"] });
    mockGetRate.mockResolvedValue({
      id: "rate-1",
      shipmentId: "shipment-1",
      carrier: "USPS",
    });
    mockPurchaseLabel.mockResolvedValue({
      status: "SUCCESS",
      carrier: "USPS",
      trackingNumber: "tracking-1",
      trackingUrl: "https://tracking.example.com/1",
      labelUrl: "https://labels.example.com/1.pdf",
      rate: "8.25",
      currency: "USD",
      messages: [],
    });
  });

  it("does not purchase a label for an order under review", async () => {
    mockGetOrder.mockResolvedValue({
      id: orderId,
      status: "review",
      fulfillment: "ship",
      fulfillment_status: "unfulfilled",
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.clone().json()).resolves.toEqual(
      expect.objectContaining({
        code: "shipping_order_not_fulfillment_ready",
        error: "This order is not paid and ready for shipping.",
      }),
    );
    expect(mockGetRate).not.toHaveBeenCalled();
    expect(mockPurchaseLabel).not.toHaveBeenCalled();
  });

  it("does not purchase a rate from a disabled carrier", async () => {
    mockGetRate.mockResolvedValue({
      id: "rate-1",
      shipmentId: "shipment-1",
      carrier: "UPS",
    });

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(mockPurchaseLabel).not.toHaveBeenCalled();
  });

  it("returns a provider error without purchasing when rate retrieval fails", async () => {
    mockGetRate.mockRejectedValue(new Error("Shippo unavailable"));

    const response = await POST(request());

    expect(response.status).toBe(502);
    expect(mockPurchaseLabel).not.toHaveBeenCalled();
  });
});
