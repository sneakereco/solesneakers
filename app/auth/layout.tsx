// app/auth/layout.tsx
import type { Viewport } from "next";

import AuthShell from "@/components/auth/ui/AuthShell";
import { getStoreAccessSettings } from "@/lib/store-access/get-store-access-settings";

export const metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const viewport: Viewport = {
  themeColor: "#f8f8f6",
};

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  let isSiteLocked = false;

  try {
    const storeAccess = await getStoreAccessSettings();
    isSiteLocked = storeAccess?.isSiteLocked ?? false;
  } catch {
    // Authentication must remain available if lock settings cannot be loaded.
  }

  return <AuthShell isSiteLocked={isSiteLocked}>{children}</AuthShell>;
}
