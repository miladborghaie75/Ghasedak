import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/checkout", "/cart", "/order/"],
    },
    sitemap: "https://ghasedak.example/sitemap.xml",
  };
}
