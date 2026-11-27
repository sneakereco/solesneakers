import { ClientShell } from "@/components/shell/ClientShell";
import { isAdminRole } from "@/config/constants/roles";
import { getServerSession } from "@/lib/auth/session";
import { checkPublicStoreAccess } from "@/lib/store-access/check-public-store-access";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const access = await checkPublicStoreAccess();
  if (!access.allowed) {
    const session = await getServerSession();
    if (!session || !isAdminRole(session.role)) redirect("/locked");
  }
  return <ClientShell>{children}</ClientShell>;
}
