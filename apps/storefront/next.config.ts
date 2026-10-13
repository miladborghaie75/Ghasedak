import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // تصاویر فعلاً SVG محلی‌اند؛ هنگام اتصال بک‌اند واقعی، remotePatterns برای object storage اضافه شود.
  // بلوک‌های صفحه‌ساز در پکیج مشترک هستند و باید ترنسپایل شوند.
  transpilePackages: ["@ghasedak/blocks", "@ghasedak/contracts", "@ghasedak/utils"],
  images: {
    // خروجی مدرن — وقتی کامپوننت‌ها به next/image مهاجرت کنند، خودکار اعمال می‌شود
    formats: ["image/avif", "image/webp"],
    // رسانه‌ها با rewrite هم‌مبدأ سرو می‌شوند؛ این الگو برای URLهای مطلقِ API است
    remotePatterns: [{ protocol: "http", hostname: "localhost", port: "4000", pathname: "/api/v1/media/**" }],
  },
  async rewrites() {
    // فروشگاه مستقیم DB را لمس نمی‌کند — رسانه هم مثل بقیهٔ داده‌ها از API می‌آید.
    // بدون این، آیکون دسته/لوگوی برند که API برمی‌گرداند ۴۰۴ می‌داد.
    const api = process.env.API_ORIGIN ?? "http://localhost:4000";
    return [
      { source: "/media/:path*", destination: `${api}/api/v1/media/:path*` },
      // شکل آدرسِ عکس محصول از API (/api/media/<key>) — نرمال‌سازی به /media هم در toV2
      { source: "/api/media/:path*", destination: `${api}/api/v1/media/:path*` },
    ];
  },
};

export default nextConfig;
