jest.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: jest.fn().mockResolvedValue({}),
}));

const getVariantsForCart = jest.fn();

jest.mock("@/repositories/product-repo", () => ({
  ProductRepository: jest.fn().mockImplementation(() => ({ getVariantsForCart })),
}));

const orderId = "44444444-4444-4444-8444-444444444444",
  productId = "11111111-1111-4111-8111-111111111111",
  variantId = "22222222-2222-4222-8222-222222222222";
const observe = jest.fn(),
  validateToken = jest.fn(),
  orderQuery = jest.fn();
jest.mock("@/lib/auth/session", () => ({ observeServerSession: () => observe() }));
jest.mock("@/services/order-access-token-service", () => ({
  OrderAccessTokenService: jest.fn().mockImplementation(() => ({ validateToken })),
}));
jest.mock("@/lib/supabase/service-role", () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: orderQuery }) }) }),
  }),
}));
import { POST } from "../../src/app/api/cart/validate/route";

describe("POST /api/cart/validate", () => {
  beforeEach(() => getVariantsForCart.mockReset());
  it.each([
    ["verified account", "u", "u", false, false, false, 1],
    ["verified guest", null, null, true, false, false, 1],
    ["unrelated ID", "b", "u", false, false, false, 0],
    ["unverified guest", null, null, false, false, false, 0],
    ["expired hold", "u", "u", false, true, false, 0],
    ["unknown attempt", "u", "u", false, false, true, 0],
  ] as const)(
    "credits stock zero only for usable own hold: %s",
    async (_label, viewer, owner, guest, expired, unknown, expected) => {
      observe.mockResolvedValue(viewer ? { user: { id: viewer } } : null);
      validateToken.mockResolvedValue(guest);
      const expiresAt = new Date(Date.now() + (expired ? -60000 : 60000)).toISOString();
      orderQuery.mockResolvedValue({
        data: {
          user_id: owner,
          status: "pending",
          checkout_attempt_guarded: true,
          expires_at: expiresAt,
          inventory_reservations: [
            {
              variant_id: variantId,
              status: "active",
              quantity: 1,
              expires_at: expiresAt,
            },
          ],
          checkout_payment_attempts: unknown ? [{ state: "unknown" }] : [],
        },
        error: null,
      });
      getVariantsForCart.mockResolvedValueOnce([
        {
          productId,
          variantId,
          sizeLabel: "10",
          brand: "",
          name: "Air Runner",
          titleDisplay: "Air Runner",
          priceCents: 1200,
          stock: 0,
          isActive: true,
          isOutOfStock: true,
          imageUrl: null,
        },
      ]);
      const response = await POST(
        new Request("https://fixture.invalid/api/cart/validate", {
          method: "POST",
          body: JSON.stringify({
            items: [{ productId, variantId, quantity: 1 }],
            order: {
              orderId,
              ...(guest ? { guestAccessToken: "synthetic-order-proof" } : {}),
            },
          }),
        }) as never,
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.contractVersion).toBe(2);
      expect(body.removed).toHaveLength(1);
      expect(body.lineState[0]).toMatchObject({
        requestedQuantity: 1,
        availableQuantity: expected,
        availability: expected ? "available" : "unavailable",
        facts: { imageUrl: "/images/logo.png" },
      });
    },
  );
  it("reports an upstream outage without logging the provider response body", async () => {
    const providerError = new Error(
      "<html>Cloudflare 522 secret provider details</html>",
    );
    getVariantsForCart.mockRejectedValueOnce(providerError);
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(
      new Request("https://shop.example.com/api/cart/validate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "request-1",
        },
        body: JSON.stringify({
          items: [
            {
              productId: "11111111-1111-4111-8111-111111111111",
              variantId: "22222222-2222-4222-8222-222222222222",
              quantity: 1,
            },
          ],
        }),
      }) as never,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Cart validation is temporarily unavailable",
      requestId: "request-1",
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    const logged = String(consoleError.mock.calls[0]?.[0]);
    expect(logged).toContain("cart_validation_upstream_unavailable");
    expect(logged).not.toContain("Cloudflare 522 secret provider details");

    consoleError.mockRestore();
  });
});
