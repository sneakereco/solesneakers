import { createSpecialtyClaimDependencies } from "@/Modules/SpecialtyProducts/Source/Features/Claim/claim-dependencies";
import { submitClaimHandler } from "@/Modules/SpecialtyProducts/Source/Features/Claim/claim-handler";
export const runtime = "nodejs";
export function POST(request: Request): Promise<Response> {
  return submitClaimHandler(request, createSpecialtyClaimDependencies());
}
