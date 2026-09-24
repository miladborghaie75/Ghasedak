import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // ادمین مستقیماً DB را لمس نمی‌کند (بند ۵) — همه فراخوانی‌ها به API
    const api = process.env.API_ORIGIN ?? "http://localhost:4000";
    return [{ source: "/api/:path*", destination: `${api}/api/v1/:path*` }];
  },
};

export default nextConfig;
