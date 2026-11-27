import type { ReactNode } from "react";

import { MeasurementProvider } from "@/Modules/Analytics/Source/Features/VisitorMeasurement/MeasurementProvider";
import { CartProvider } from "@/components/cart/CartProvider";
import { SessionProvider } from "@/contexts/SessionContext";
import { isDynamicServerError } from "next/dist/client/components/hooks-server-context";
import { readServerSession } from "@/lib/auth/session";
import { logError } from "@/lib/utils/log";

export async function SessionShell({ children }: { children: ReactNode }) {
  const initial = await readServerSession()
    .then((session) => ({ session, unavailable: false }))
    .catch((error: unknown) => {
      if (isDynamicServerError(error)) throw error;
      logError(error, {
        layer: "auth",
        route: "SessionShell",
        message: "server_session_lookup_failed",
      });
      return { session: null, unavailable: true };
    });
  const { session } = initial;
  const user = session?.user ? { id: session.user.id, email: session.user.email } : null;

  return (
    <SessionProvider
      initialUser={user}
      initialRole={session?.role ?? null}
      initialUnavailable={initial.unavailable}
      serverReadId={crypto.randomUUID()}
    >
      <MeasurementProvider>
        <CartProvider userId={user?.id ?? null}>{children}</CartProvider>
      </MeasurementProvider>
    </SessionProvider>
  );
}
