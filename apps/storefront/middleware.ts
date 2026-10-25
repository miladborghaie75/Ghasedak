import { NextResponse, type NextRequest } from "next/server";

/**
 * قفل دامنهٔ کانونیکال (تصمیم قطعی #۴ — گام ۲۰):
 * کانونیکال `https://www.lebaszirghasedak.ir` است؛ apex با ۳۰۱ دائمی به www می‌رود.
 * فقط در production و فقط اگر هاست درخواست واقعاً apex دامنهٔ سایت باشد ریدایرکت
 * می‌شود — سابدامنه/دامنهٔ پیش‌نمایش و localhost دست نمی‌خورند.
 * برای تست‌پذیری، هاست کانونیکال از env می‌آید (پیش‌فرض: www دامنهٔ رسمی).
 */
const CANONICAL_HOST = (process.env.CANONICAL_HOST ?? "www.lebaszirghasedak.ir").toLowerCase();
/** apex (بدون www) — اگر کانونیکال خودش www نباشد، apex همان کانونیکال است و ریدایرکتی در کار نیست */
const APEX_HOST = CANONICAL_HOST.startsWith("www.")
  ? CANONICAL_HOST.slice("www.".length)
  : CANONICAL_HOST;

/** بدون پایان‌اسلش — سیاست واحد ساختار URL (جز ریشه)؛ ۳۰۸ روش/بدنه را حفظ می‌کند */
function needsTrailingSlashFix(pathname: string): boolean {
  return pathname.length > 1 && pathname.endsWith("/");
}

export function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // ۱) ریدایرکت دامنه — apex → www با ۳۰۱ دائمی (فقط production؛ host بدون پورت)
  if (process.env.NODE_ENV === "production") {
    const host = (req.headers.get("host") ?? "").toLowerCase().split(":")[0];
    if (host && host === APEX_HOST && APEX_HOST !== CANONICAL_HOST) {
      const url = req.nextUrl.clone();
      url.protocol = "https";
      url.host = CANONICAL_HOST;
      url.port = "";
      return NextResponse.redirect(url, 301);
    }
  }

  // ۲) پایان‌اسلش — `/path/` → `/path` (ریشه استثناست)؛ اول مسیر تمیز می‌شود
  // و بعد پارامترها دوباره اضافه می‌گردند تا چیزی از دست نرود
  if (needsTrailingSlashFix(req.nextUrl.pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = url.pathname.replace(/\/+$/, "");
    return NextResponse.redirect(url, 308);
  }

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
