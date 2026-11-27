// app/layout.tsx

import { Suspense } from "react";
import type { Metadata, Viewport } from "next";

import { RootLoadingShell } from "@/components/shell/RootLoadingShell";
import { SessionShell } from "@/components/shell/SessionShell";
import { pageMetadata } from "@/lib/metadata";
import "@/styles/site.css";

export const metadata: Metadata = pageMetadata(
  "Authentic Sneakers & Streetwear",
  "Shop authentic new and pre-owned sneakers, streetwear, and accessories at Solesneakers. Browse the latest arrivals for shipping or local pickup.",
);

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Suspense fallback={<RootLoadingShell />}>
          <SessionShell>{children}</SessionShell>
        </Suspense>
      </body>
    </html>
  );
}
