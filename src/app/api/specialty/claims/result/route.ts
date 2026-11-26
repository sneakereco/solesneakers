import { createSpecialtyClaimDependencies } from "@/Modules/SpecialtyProducts/Source/Features/Claim/claim-dependencies";
import { recoverClaimHandler } from "@/Modules/SpecialtyProducts/Source/Features/Claim/claim-handler";
export const runtime = "nodejs";
export function POST(request: Request): Promise<Response> {
  return recoverClaimHandler(request, createSpecialtyClaimDependencies());
}
