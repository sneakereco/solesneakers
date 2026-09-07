jest.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: jest.fn().mockResolvedValue({}),
}));

const getVariantsForCart = jest.fn();

jest.mock("@/repositories/product-repo", () => ({
  ProductRepository: jest.fn().mockImplementation(() => ({ getVariantsForCart })),
}));

import { POST } from "../../app/api/cart/validate/route";

describe("POST /api/cart/validate", () => {
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
