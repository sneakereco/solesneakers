// app/admin/layout.tsx
import { requireAdmin } from "@/lib/auth/session";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminTopbar } from "@/components/admin/AdminTopbar";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();
  const userEmail = session.user.email ?? session.profile?.email ?? null;

  return (
    <div data-admin-shell className="min-h-screen bg-[#f4f4f0] text-zinc-950">
      <AdminSidebar userEmail={userEmail} role={session.role} />

      <div className="flex min-h-screen flex-col md:ml-[17.5rem]">
        <AdminTopbar />
        <main
          data-admin-content
          className="flex-1 px-4 pb-12 pt-5 sm:px-6 md:px-8 md:pb-16 md:pt-8 xl:px-10"
        >
          <div className="mx-auto w-full max-w-[96rem]">{children}</div>
        </main>
      </div>
    </div>
  );
}
