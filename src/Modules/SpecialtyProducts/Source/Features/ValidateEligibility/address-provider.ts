import { requestAddressValidation } from "@/lib/shipping/validate-shipping-address";
import {
  eligibilityAddressSchema,
  type EligibilityAddress,
} from "../Claim/claim-contract";
import { canonicalAddressIdentity } from "../Claim/normalize-identity";

export type EligibilityAddressDecision =
  | { status: "valid"; address: EligibilityAddress }
  | { status: "correction_required"; address: EligibilityAddress }
  | { status: "invalid" }
  | { status: "unavailable" };

export async function validateEligibilityAddress(
  address: EligibilityAddress,
  deps: { token: string; fetcher: typeof fetch },
): Promise<EligibilityAddressDecision> {
  try {
    const input = eligibilityAddressSchema.safeParse(address);
    if (!input.success) return { status: "invalid" };
    const result = await requestAddressValidation(
      input.data,
      deps.token,
      deps.fetcher,
      8000,
    );
    if (!result) return { status: "unavailable" };
    const verdict = result.analysis.validation_result.value;
    if (verdict !== "valid" && verdict !== "partially_valid")
      return { status: "invalid" };
    const recommended = result.recommended_address;
    if (!recommended) return { status: verdict === "valid" ? "unavailable" : "invalid" };
    const parsed = eligibilityAddressSchema.safeParse({
      line1: recommended.address_line_1,
      line2: recommended.address_line_2 ?? null,
      city: recommended.city_locality,
      state: recommended.state_province,
      postalCode: recommended.postal_code,
      country: recommended.country_code,
    });
    if (!parsed.success) return { status: "invalid" };
    const before = canonicalAddressIdentity(input.data);
    const after = canonicalAddressIdentity(parsed.data);
    const enteredUnit: string = JSON.parse(before)[1];
    const suggestedUnit: string = JSON.parse(after)[1];
    if (enteredUnit && enteredUnit !== suggestedUnit) return { status: "invalid" };
    if (verdict === "valid" && before === after)
      return { status: "valid", address: parsed.data };
    if (recommended.confidence_result?.score !== "high") return { status: "invalid" };
    return { status: "correction_required", address: parsed.data };
  } catch {
    return { status: "unavailable" };
  }
}
