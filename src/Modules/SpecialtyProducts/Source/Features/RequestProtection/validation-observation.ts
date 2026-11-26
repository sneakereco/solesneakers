import type { EligibilityDependencies } from "../ValidateEligibility/validate-eligibility-handler";
import type { EligibilityAddress } from "../Claim/claim-contract";
import type { ClaimMetric } from "./claim-telemetry";

export async function observeAddressValidation(
  deps: Pick<EligibilityDependencies, "nowMs" | "validateAddress" | "recordMetric">,
  address: EligibilityAddress,
  context: Pick<ClaimMetric, "requestId" | "productId" | "campaignId">,
) {
  const started = deps.nowMs();
  let outcome: ClaimMetric["outcome"] = "unavailable";
  try {
    const result = await deps.validateAddress(address);
    outcome = result.status;
    return result;
  } finally {
    try {
      deps.recordMetric?.({
        ...context,
        operation: "validate",
        event: "validation",
        outcome,
        durationMs: Math.max(0, deps.nowMs() - started),
        ...(outcome === "unavailable"
          ? { failure: "address_provider_unavailable" as const }
          : {}),
      });
    } catch {
      /* Metrics never change validation. */
    }
  }
}
