import { z } from "zod";

import { checkoutShippingAddressSchema } from "@/lib/checkout/checkout-request";
import { shippingAddressKey } from "@/lib/checkout/shipping-address-validation";
import type {
  ShippingAddress,
  ShippingValidationResult,
} from "@/lib/checkout/shipping-address-validation";

const shippoResponse = z.object({
  analysis: z.object({ validation_result: z.object({ value: z.string() }) }),
  recommended_address: z
    .object({
      address_line_1: z.string().nullable().optional(),
      address_line_2: z.string().nullable().optional(),
      city_locality: z.string().nullable().optional(),
      state_province: z.string().nullable().optional(),
      postal_code: z.string().nullable().optional(),
      country_code: z.string().nullable().optional(),
      confidence_result: z.object({ score: z.string() }).optional(),
    })
    .nullable()
    .optional(),
});

export async function validateShippingAddress(
  address: ShippingAddress,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<ShippingValidationResult> {
  if (!token) {
    return { status: "unavailable" };
  }
  // Shippo v2 limits. Do not truncate a destination to make it pass validation.
  if (
    address.line1.length > 100 ||
    (address.line2?.length ?? 0) > 50 ||
    address.city.length > 64
  ) {
    return { status: "invalid" };
  }
  const url = new URL("https://api.goshippo.com/v2/addresses/validate");
  url.search = new URLSearchParams({
    address_line_1: address.line1,
    address_line_2: address.line2 ?? "",
    city_locality: address.city,
    state_province: address.state,
    postal_code: address.postalCode,
    country_code: address.country,
  }).toString();
  try {
    const response = await fetcher(url.toString(), {
      headers: { Authorization: `ShippoToken ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      return { status: "unavailable" };
    }
    const parsed = shippoResponse.safeParse(await response.json());
    if (!parsed.success) {
      return { status: "unavailable" };
    }
    const { analysis, recommended_address: recommended } = parsed.data;
    const verdict = analysis.validation_result.value;
    if (verdict !== "valid" && verdict !== "partially_valid") {
      return { status: "invalid" };
    }
    if (!recommended) {
      return { status: verdict === "valid" ? "valid" : "invalid" };
    }
    const suggestion = checkoutShippingAddressSchema.safeParse({
      ...address,
      line1: recommended.address_line_1,
      line2: recommended.address_line_2 ?? null,
      city: recommended.city_locality,
      state: recommended.state_province,
      postalCode: recommended.postal_code,
      country: recommended.country_code,
    });
    if (!suggestion.success || (address.line2?.trim() && !suggestion.data.line2)) {
      return { status: "invalid" };
    }
    if (shippingAddressKey(address) === shippingAddressKey(suggestion.data)) {
      return { status: verdict === "valid" ? "valid" : "invalid" };
    }
    if (recommended.confidence_result?.score !== "high") {
      return { status: "invalid" };
    }
    return { status: "suggestion", address: suggestion.data };
  } catch {
    // Provider errors can contain the address or request headers. Never log them.
    return { status: "unavailable" };
  }
}
