/**
 * پراکسی رضایت آنالیتیکس (گام ۱۵-۱) — الگوی /api/checkout:
 * CSRF همان double-submit؛ هویت مهمان همان توکن سبد (httpOnly) که فقط
 * همین مسیر سمت سرور می‌خواند و به ConsentRecord سرور می‌فرستد.
 */
export const dynamic = "force-dynamic";

import { csrfOk } from "@/lib/csrf";

export async function POST(req: Request) {
  if (!csrfOk(req)) {
    return Response.json(
      { ok: false, error: { code: "CSRF_INVALID", message: "نشست این صفحه منقضی شده است." } },
      { status: 403 },
    );
  }
  const raw = req.headers.get("cookie") ?? "";
  const m = raw.match(/(?:^|;\s*)cart_token=([^;]+)/);
  const sessionKey = m ? decodeURIComponent(m[1]) : "";
  if (!sessionKey) {
    return Response.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "شناسه نشست موجود نیست؛ صفحه را دوباره باز کن." } },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => null)) as
    | { kind?: string; granted?: boolean; source?: string }
    | null;
  if (!body || (body.kind !== "ANALYTICS" && body.kind !== "COOKIES") || typeof body.granted !== "boolean") {
    return Response.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "درخواست ناتمام ماند." } },
      { status: 400 },
    );
  }

  const api = process.env.API_ORIGIN ?? "http://localhost:4000";
  const upstream = await fetch(`${api}/api/v1/analytics/public/consent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionKey,
      kind: body.kind,
      granted: body.granted,
      source: String(body.source ?? "storefront").slice(0, 60),
    }),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);

  if (!upstream || !upstream.ok) {
    // رضایت محلی از قبل ذخیره شده؛ خطای سرور تجربهٔ خرید را نمی‌شکند
    return Response.json({ ok: false }, { status: 502 });
  }
  return Response.json({ ok: true });
}
