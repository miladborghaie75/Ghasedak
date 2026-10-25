/**
 * CSRF — الگوی double-submit cookie (تک‌منبع فروشگاه).
 *
 * سمت سرور (route handler): `csrfOk(req)` — کوکی `csrf_token` باید با هدر
 * `x-csrf-token` یکی باشد؛ نابرابری یا نبودن → ۴۰۳ با `csrfForbidden()`.
 * سمت کلاینت: `csrfHeaders()` — همان مقدار کوکی را در هدر می‌فرستد.
 * کوکی در middleware.ts ساخته می‌شود (خوانا توسط JS، sameSite=lax).
 */

/** اعتبارسنجی double-submit: کوکی `csrf_token` === هدر `x-csrf-token` */
export function csrfOk(req: Request): boolean {
  const raw = req.headers.get("cookie") ?? "";
  const m = raw.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  const cookieToken = m ? decodeURIComponent(m[1]) : "";
  const headerToken = req.headers.get("x-csrf-token") ?? "";
  return cookieToken !== "" && headerToken !== "" && cookieToken === headerToken;
}

/** پاسخ استاندارد ۴۰۳ وقتی توکن نامعتبر/غایب است — پیام فارسیِ دیده‌شده توسط کاربر */
export function csrfForbidden(message = "نشست این صفحه منقضی شده است؛ صفحه را دوباره باز کن و دوباره تلاش کن."): Response {
  return Response.json(
    { ok: false, error: { code: "CSRF_INVALID", message } },
    { status: 403 },
  );
}

/** سمت کلاینت: ساخت هدر `x-csrf-token` از کوکی خوانا — فقط مرورگر */
export function csrfHeaders(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  const token = m ? decodeURIComponent(m[1]) : "";
  return token ? { "x-csrf-token": token } : {};
}
