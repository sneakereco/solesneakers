// app/auth/layout.tsx
import type { Viewport } from "next";

import AuthShell from "@/components/auth/ui/AuthShell";

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

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
