import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // بوم صفحه‌ساز از همان کامپوننت‌های فروشگاه استفاده می‌کند
  transpilePackages: ["@ghasedak/blocks", "@ghasedak/contracts"],
  // گام ۳۲ (F3-8) — سرفصل‌های امنیتی پایه؛ ادمین noindex است و کش نمی‌شود
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  async rewrites() {
    // ادمین مستقیماً DB را لمس نمی‌کند (بند ۵) — همه فراخوانی‌ها به API
    const api = process.env.API_ORIGIN ?? "http://localhost:4000";
    return [
      { source: "/api/:path*", destination: `${api}/api/v1/:path*` },
      // رسانه برای پیش‌نمایش صفحه‌ساز — بدون این، تصاویر بلوک‌ها در ادمین ۴۰۴ می‌دادند
      { source: "/media/:path*", destination: `${api}/api/v1/media/:path*` },
    ];
  },
};

export default nextConfig;
