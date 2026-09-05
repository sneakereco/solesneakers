jest.mock("@/lib/auth/session", () => ({ requireAdminApi: jest.fn() }));
jest.mock("@/lib/supabase/service-role", () => ({
  createSupabaseAdminClient: jest.fn(),
}));
jest.mock("@/repositories/shipping-origins-repo", () => ({
  ShippingOriginsRepository: jest.fn(),
}));
jest.mock("@/repositories/shipping-carriers-repo", () => ({
  ShippingCarriersRepository: jest.fn(),
}));
jest.mock("@/repositories/addresses-repo", () => ({
  AddressesRepository: jest.fn(),
}));
jest.mock("@/services/shipping-label-service", () => ({ ShippoService: jest.fn() }));

import { requireAdminApi } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { AddressesRepository } from "@/repositories/addresses-repo";
import { ShippingCarriersRepository } from "@/repositories/shipping-carriers-repo";
import { ShippingOriginsRepository } from "@/repositories/shipping-origins-repo";
import { ShippoService } from "@/services/shipping-label-service";

import { POST } from "../../app/api/admin/shipping/rates/route";

const mockGetOrigin = jest.fn();
const mockGetCarriers = jest.fn();
const mockGetShipping = jest.fn();
const mockCreateShipment = jest.fn();
const orderId = "11111111-1111-4111-8111-111111111111";

function request() {
  return new Request("https://shop.example.com/api/admin/shipping/rates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      orderId,
      weight: 16,
      length: 12,
      width: 8,
      height: 4,
      recipient: {
        name: "Substituted Recipient",
        phone: "2125550100",
        line1: "999 Wrong St",
        line2: null,
        city: "New York",
        state: "NY",
        postal_code: "10003",
        country: "US",
      },
    }),
  }) as Parameters<typeof POST>[0];
}

describe("POST /api/admin/shipping/rates", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(requireAdminApi).mockResolvedValue({} as never);
    jest.mocked(createSupabaseAdminClient).mockReturnValue({} as never);
    jest
      .mocked(ShippingOriginsRepository)
      .mockImplementation(() => ({ get: mockGetOrigin }) as never);
    jest
      .mocked(ShippingCarriersRepository)
      .mockImplementation(() => ({ get: mockGetCarriers }) as never);
    jest
      .mocked(AddressesRepository)
      .mockImplementation(() => ({ getOrderShipping: mockGetShipping }) as never);
    jest
      .mocked(ShippoService)
      .mockImplementation(() => ({ createShipment: mockCreateShipment }) as never);
    mockGetOrigin.mockResolvedValue({
      name: "Store",
      phone: "2125550199",
      line1: "1 Origin St",
      city: "New York",
      state: "NY",
      postal_code: "10001",
      country: "US",
    });
    mockGetCarriers.mockResolvedValue({ enabled_carriers: ["USPS"] });
    mockGetShipping.mockResolvedValue({
      name: "Square Recipient",
      phone: "2125550101",
      line1: "2 Square St",
      line2: null,
      city: "New York",
      state: "NY",
      postal_code: "10002",
      country: "US",
      square_synced_at: "2026-09-05T12:00:00.000Z",
    });
    mockCreateShipment.mockResolvedValue({
      id: "shipment-1",
      rates: [
        {
          id: "rate-1",
          shipmentId: "shipment-1",
          carrier: "USPS",
          service: "Ground Advantage",
          rate: "8.25",
          currency: "USD",
          estimated_delivery_days: 3,
        },
      ],
    });
  });

  it("uses the Square-synchronized address instead of a submitted recipient", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mockCreateShipment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "Square Recipient",
        street1: "2 Square St",
        zip: "10002",
      }),
      expect.anything(),
    );
  });

  it("does not request rates without a Square synchronization stamp", async () => {
    mockGetShipping.mockResolvedValue({
      phone: "2125550101",
      line1: "2 Square St",
      city: "New York",
      state: "NY",
      postal_code: "10002",
      country: "US",
      square_synced_at: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(mockCreateShipment).not.toHaveBeenCalled();
  });
});
