import { ClientShell } from "@/components/shell/ClientShell";

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return <ClientShell>{children}</ClientShell>;
}
