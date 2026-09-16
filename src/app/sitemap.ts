import type { MetadataRoute } from "next";

import { BRAND_SITE_URL } from "@/config/constants/brand";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    // Homepage
    {
      url: BRAND_SITE_URL,
      lastModified: new Date().toISOString(),
      changeFrequency: "weekly",
      priority: 1.0,
    },

    {
      url: `${BRAND_SITE_URL}/store`,
      lastModified: new Date().toISOString(),
      changeFrequency: "weekly",
      priority: 0.8,
    },

    {
      url: `${BRAND_SITE_URL}/brands`,
      lastModified: new Date().toISOString(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];
}
