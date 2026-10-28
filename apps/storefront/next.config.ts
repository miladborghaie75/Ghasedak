import type { NextConfig } from "next";

/**
 * مبدأهای مجازِ قرارگرفتن سایت در iframe (CSP `frame-ancestors`).
 * فقط پنل صفحه‌ساز لازمش دارد (بوم روی مبدأ پنل)؛ بقیهٔ سایت‌ها مسدود.
 * در production باید شامل `https://admin.lebaszirghasedak.ir` باشد — در .env.example ثبت است.
 */
const frameAncestors = [
  "'self'",
  ...(process.env.FRAME_ALLOWED_ORIGINS ?? "http://localhost:3200,https://admin.lebaszirghasedak.ir")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
].join(" ");

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
  // گام ۳۲ (F3-8) — سرفصل‌های امنیتی پایه روی همهٔ پاسخ‌ها.
  // HSTS/CSP کامل در reverse proxy لایهٔ prod اعمال می‌شود (گام ۳۶ — Nginx)؛
  // اگر آنجا CSP دیگری گذاشتید، دو هدر CSP هم‌رونداند (شدت‌ترین برنده) —
  // `frame-ancestors` باید در هر دو یکسان باشد.
  //
  // چرا X-Frame-Options SAMEORIGIN نیست (اصلاح گام ۲۸): بوم صفحه‌سازِ ادمین
  // همین سایت را داخل iframe روی **مبدأ پنل** (۳۲۰۰ / admin.lebaszirghasedak.ir)
  // می‌بیند ⇒ SAMEORIGIN پیش‌نمایش زنده را کامل می‌شکست (خطای کنسول در ماتریس
  // چک‌لیست تصویری). جایگزین: CSP `frame-ancestors` با فهرست صریح — پنل مجاز،
  // بقیهٔ سایت‌ها همچنان مسدود (بهتر از SAMEORIGIN، نه بدتر).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Content-Security-Policy", value: `frame-ancestors ${frameAncestors}` },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
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
