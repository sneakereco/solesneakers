import { requireAdminApi } from "@/lib/auth/session";
import {
  updateSpecialtyClaimStatus,
  adminClaimStatusSchema,
} from "@/Modules/SpecialtyProducts/Source/Features/ManageClaims/admin-claims";
import { adminClaimFailure } from "@/Modules/SpecialtyProducts/Source/Features/ManageClaims/admin-claim-http";
import {
  privateClaimReply,
  readClaimJson,
} from "@/Modules/SpecialtyProducts/Source/Features/Claim/claim-http";
export const runtime = "nodejs";
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ claimId: string }> },
): Promise<Response> {
  try {
    const session = await requireAdminApi();
    const input = adminClaimStatusSchema.parse(await readClaimJson(request));
    return privateClaimReply(
      await updateSpecialtyClaimStatus(
        { ...input, claimId: (await params).claimId },
        session.user.id,
      ),
    );
  } catch (error) {
    return adminClaimFailure(error);
  }
}
