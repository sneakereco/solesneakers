import { shippingAddressKey } from "@/lib/checkout/shipping-address-validation";
import { loadDigest } from "./contracts";
import type { LoadTestContext } from "./context";
import type { RunStore } from "./run-store";

export function createLoadTestShippingFetch(
  context: LoadTestContext,
  store: RunStore,
): typeof fetch {
  return async (input) => {
    const url = new URL(String(input));
    if (
      url.origin !== "https://api.goshippo.com" ||
      url.pathname !== "/v2/addresses/validate"
    )
      throw new Error("Unexpected simulated address endpoint");
    const address = {
      line1: url.searchParams.get("address_line_1") ?? "",
      line2: url.searchParams.get("address_line_2") ?? "",
      city: url.searchParams.get("city_locality") ?? "",
      state: url.searchParams.get("state_province") ?? "",
      postalCode: url.searchParams.get("postal_code") ?? "",
      country: url.searchParams.get("country_code") ?? "",
    };
    if (address.country !== "US") throw new Error("Unsupported load-test destination");
    const owner = await store.get<{ runId: string }>(
      "fixture",
      `address:${loadDigest(shippingAddressKey({ ...address, name: "", phone: "", country: "US" }))}`,
    );
    if (owner?.runId !== context.runId) throw new Error("Unregistered address fixture");
    const fault = await store.get<{ kind?: string }>("fault", context.runId);
    if (fault?.kind === "shippo-unavailable") return new Response("{}", { status: 503 });
    return Response.json({
      analysis: { validation_result: { value: "valid" } },
      recommended_address: null,
    });
  };
}
