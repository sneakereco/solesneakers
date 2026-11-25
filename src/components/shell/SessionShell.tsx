import type { ReactNode } from "react";

import { CartProvider } from "@/components/cart/CartProvider";
import { SessionProvider } from "@/contexts/SessionContext";
import { getServerSession } from "@/lib/auth/session";

export async function SessionShell({ children }: { children: ReactNode }) {
  const session = await getServerSession();
  const user = session?.user ? { id: session.user.id, email: session.user.email } : null;

  return (
    <SessionProvider initialUser={user} initialRole={session?.role ?? null}>
      <CartProvider userId={user?.id ?? null}>{children}</CartProvider>
    </SessionProvider>
  );
}
