import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // مسیرهای کاربردی/حساس که نباید ایندکس شوند — سفارش، سبد، حساب، پنل و علاقه‌مندی
      disallow: ["/checkout", "/cart", "/order/", "/account", "/admin", "/wishlist"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
