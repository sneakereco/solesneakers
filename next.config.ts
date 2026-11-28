import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";

import { env } from "@/config/env";

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseHostname = supabaseUrl ? new URL(supabaseUrl).hostname : undefined;

const supabaseRemotePattern = supabaseHostname
  ? ({
      protocol: "https",
      hostname: supabaseHostname,
      pathname: "/storage/v1/object/public/**",
    } as const)
  : null;

const nextConfig = {
  reactStrictMode: true,

  images: {
    // Local Supabase URLs are private-network sources; optimize hosted deployments.
    unoptimized: process.env.NODE_ENV === "development",
    formats: ["image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920], // Responsive breakpoints
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384], // Icon/thumbnail sizes
    minimumCacheTTL: 14_400, // Reuse optimized images for at least four hours.
    qualities: [60, 75, 85, 90],
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    remotePatterns: [
      ...(supabaseRemotePattern ? [supabaseRemotePattern] : []),
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      } as const,
      {
        protocol: "https",
        hostname: "*.cloudfront.net",
      } as const,
      {
        protocol: "https",
        hostname: "*.fastly.net",
      } as const,
    ],
  },

  // OPTIMIZATION 2: Reduce bundle size with package import optimization
  experimental: {
    optimizePackageImports: ["lucide-react"], // Tree-shake icons
  },

  // OPTIMIZATION 4: Compiler optimizations
  compiler: {
    removeConsole:
      process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false, // Remove console.logs in production
  },

  // Let Next.js own framework asset caching. Dev chunk URLs are stable, so marking
  // them immutable causes browsers to keep stale CSS and JavaScript across edits.
  headers() {
    if (process.env.NODE_ENV !== "production") {
      return [];
    }

    return [
      {
        source: "/store/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=60, stale-while-revalidate=120",
          },
        ],
      },
    ];
  },
} satisfies NextConfig;

export default withBotId(nextConfig);
