import { requireAdmin } from "@/lib/auth/session";
import { AdminPage, AdminPageHeader } from "@/components/admin/AdminPage";
import {
  getSpecialtyCampaignState,
  listSpecialtyClaims,
  listSpecialtyClaimProducts,
} from "@/Modules/SpecialtyProducts/Source/Features/ManageClaims/admin-claims";
import { SpecialtyClaimsClient } from "@/Modules/SpecialtyProducts/Source/Features/ManageClaims/SpecialtyClaimsClient";
export const dynamic = "force-dynamic";
export default async function SpecialtyClaimsPage() {
  await requireAdmin();
  const [initial, campaign, products] = await Promise.all([
    listSpecialtyClaims({ page: 1, pageSize: 25 }),
    getSpecialtyCampaignState(),
    listSpecialtyClaimProducts(),
  ]);
  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="Commerce"
        title="Specialty Product Claims"
        description="Contact giveaway winners and track prize arrangements."
      />
      <SpecialtyClaimsClient initial={initial} campaign={campaign} products={products} />
    </AdminPage>
  );
}
