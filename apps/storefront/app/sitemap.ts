import type { MetadataRoute } from "next";
import { getAllProductsV2 } from "@/lib/catalog-repo";
import { CATEGORIES } from "@/lib/categories";
import { guides } from "@/lib/guides-data";

export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://ghasedak.example";
  const now = new Date();

  return [
    { url: base, lastModified: now, priority: 1 },
    ...CATEGORIES.map((c) => ({
      url: `${base}/c/${c.slug}`,
      lastModified: now,
      priority: 0.9,
    })),
    ...getAllProductsV2().map((p) => ({
      url: `${base}/p/${p.slug}`,
      lastModified: now,
      priority: 0.8,
    })),
    ...Object.keys(guides).map((slug) => ({
      url: `${base}/guides/${slug}`,
      lastModified: now,
      priority: 0.6,
    })),
    { url: `${base}/need`, lastModified: now, priority: 0.5 },
    { url: `${base}/search`, lastModified: now, priority: 0.3 },
  ];
}
