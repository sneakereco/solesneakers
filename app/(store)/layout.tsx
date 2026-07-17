import { ClientShell } from "@/components/shell/ClientShell";
import { isAdminRole } from "@/config/constants/roles";
import { getServerSession } from "@/lib/auth/session";

export default async function StoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();
  const role = session?.role ?? null;
  const userEmail = session?.user.email ?? session?.profile?.email;
  const isAuthenticated = Boolean(session);
  const isAdmin = role ? isAdminRole(role) : false;

  return (
    <ClientShell
      isAdmin={isAdmin}
      isAuthenticated={isAuthenticated}
      userEmail={userEmail}
      role={role}
    >
      {children}
    </ClientShell>
  );
}
