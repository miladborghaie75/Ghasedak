import { NextResponse, type NextRequest } from "next/server";

/**
 * محافظت CSRF (فاز ۱ — گام ۲): الگوی double-submit cookie.
 * یک توکن تصادفی در کوکی `csrf_token` (خواندنی توسط JS) قرار می‌گیرد؛
 * کلاینت همان مقدار را در هدر `x-csrf-token` می‌فرستد و route اعتبارسنجی می‌کند.
 * `sameSite=lax` + بررسی هدر = جلوگیری از درخواست جعلی از سایت دیگر.
 */
export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const existing = req.cookies.get("csrf_token")?.value;
  if (!existing) {
    const token = crypto.randomUUID();
    res.cookies.set("csrf_token", token, {
      httpOnly: false, // کلاینت باید بخواند و در هدر بفرستد
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24, // ۱ روز
    });
  }
  // توکن سبد سروری — httpOnly است؛ فقط پراکسی‌های /api/cart آن را می‌خوانند
  if (!req.cookies.get("cart_token")?.value) {
    res.cookies.set("cart_token", crypto.randomUUID(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // ۳۰ روز
    });
  }
  return res;
}

/** همهٔ مسیرها به‌جز دارایی‌های ثابت Next */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
