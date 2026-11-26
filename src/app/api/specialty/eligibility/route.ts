import { createSpecialtyClaimDependencies } from "@/Modules/SpecialtyProducts/Source/Features/Claim/claim-dependencies";
import { validateEligibilityHandler } from "@/Modules/SpecialtyProducts/Source/Features/ValidateEligibility/validate-eligibility-handler";
export const runtime = "nodejs";
export function POST(request: Request): Promise<Response> {
  return validateEligibilityHandler(request, createSpecialtyClaimDependencies());
}
