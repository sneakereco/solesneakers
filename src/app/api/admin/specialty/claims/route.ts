import { requireAdminApi } from "@/lib/auth/session";
import {
  listSpecialtyClaims,
  adminClaimsQuerySchema,
} from "@/Modules/SpecialtyProducts/Source/Features/ManageClaims/admin-claims";
import { adminClaimFailure } from "@/Modules/SpecialtyProducts/Source/Features/ManageClaims/admin-claim-http";
import { privateClaimReply } from "@/Modules/SpecialtyProducts/Source/Features/Claim/claim-http";
export const runtime = "nodejs";
export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdminApi();
    const params = new URL(request.url).searchParams;
    const input = adminClaimsQuerySchema.parse(Object.fromEntries(params));
    return privateClaimReply(await listSpecialtyClaims(input));
  } catch (error) {
    return adminClaimFailure(error);
  }
}
