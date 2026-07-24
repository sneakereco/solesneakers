// app/layout.tsx

import type { Metadata, Viewport } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";

import { CartProvider } from "@/components/cart/CartProvider";
import { SessionProvider } from "@/contexts/SessionContext";
import { getServerSession } from "@/lib/auth/session";
import "@/styles/site.css";

export const metadata: Metadata = {
  title: "Sole Sneakers - Premium Sneakers & Streetwear",
  description: "Authentic sneakers and streetwear. Quality guaranteed.",
};

// OPTIMIZATION: Proper viewport configuration for mobile performance
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5, // Allow zooming for accessibility
  minimumScale: 1,
  userScalable: true,
  viewportFit: "cover", // Safe area insets on iOS
  // Theme color for mobile browsers
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  const role = session?.role ?? null;
  const userId = session?.user.id ?? null;

  // OPTIMIZATION: Prepare session for client-side context
  const sessionUser = session?.user
    ? {
        id: session.user.id,
        email: session.user.email,
      }
    : null;

  return (
    <html lang="en">
      <body>
        <SessionProvider initialUser={sessionUser} initialRole={role}>
          <CartProvider userId={userId}>{children}</CartProvider>
        </SessionProvider>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
