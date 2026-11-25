import { requireAdminApi } from "@/lib/auth/session";
import {
  getSpecialtyCampaignState,
  setSpecialtyCampaignEnabled,
  adminCampaignWriteSchema,
} from "@/Modules/SpecialtyProducts/Source/Features/ManageClaims/admin-claims";
import { adminClaimFailure } from "@/Modules/SpecialtyProducts/Source/Features/ManageClaims/admin-claim-http";
import {
  privateClaimReply,
  readClaimJson,
} from "@/Modules/SpecialtyProducts/Source/Features/Claim/claim-http";
export const runtime = "nodejs";
export async function GET(): Promise<Response> {
  try {
    await requireAdminApi();
    return privateClaimReply(await getSpecialtyCampaignState());
  } catch (error) {
    return adminClaimFailure(error);
  }
}
export async function PATCH(request: Request): Promise<Response> {
  try {
    const session = await requireAdminApi();
    return privateClaimReply(
      await setSpecialtyCampaignEnabled(
        adminCampaignWriteSchema.parse(await readClaimJson(request)),
        session.user.id,
      ),
    );
  } catch (error) {
    return adminClaimFailure(error);
  }
}
