import type { Metadata } from "next";

import { BRAND_NAME, BRAND_SITE_URL } from "@/config/constants/brand";

export function pageMetadata(title: string, description: string): Metadata {
  const fullTitle = `${title} | ${BRAND_NAME}`;
  const logo = "/images/logo.png";
  return {
    metadataBase: new URL(BRAND_SITE_URL),
    title: fullTitle,
    description,
    openGraph: {
      type: "website",
      siteName: BRAND_NAME,
      title: fullTitle,
      description,
      images: [{ url: logo, alt: BRAND_NAME }],
    },
    twitter: {
      card: "summary",
      title: fullTitle,
      description,
      images: [logo],
    },
  };
}
