/**
 * پراکسی شمارش بازدید (گام ۱۵-۶) — همان الگوی /api/analytics/consent:
 * CSRF با double-submit؛ هویت مهمان همان توکن سبد httpOnly که فقط همین
 * مسیر سمت سرور می‌خواند. شمارش همیشه‌روشن است (D-5) و به رضایت وصل نیست.
 *
 * مقاوم‌سازی (D-6): UA خزنده اینجا رد می‌شود (صرفه‌جویی فراخوانی API) —
 * فهرست مشترک از @ghasedak/contracts و فیلتر نهایی همان‌جا سمت API هم هست.
 * UA و IP واقعی به API فوروارد می‌شوند تا مرز نهایی حقیقت همانجا باشد.
 */
export const dynamic = "force-dynamic";

import { isBotUa } from "@ghasedak/contracts";
import { csrfOk } from "@/lib/csrf";

export async function POST(req: Request) {
  if (!csrfOk(req)) {
    // آمار نباید مسیر خرید را بشکند — بی‌جواب نمی‌مانیم، ولی چیزی نمی‌شماریم
    return Response.json({ ok: false }, { status: 403 });
  }
  const raw = req.headers.get("cookie") ?? "";
  const m = raw.match(/(?:^|;\s*)cart_token=([^;]+)/);
  const sessionKey = m ? decodeURIComponent(m[1]) : "";
  if (!sessionKey) {
    return Response.json({ ok: false }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as { path?: string } | null;
  const path = String(body?.path ?? "/").slice(0, 200);

  // خزنده/ابزار معروف: حتی به API هم نمی‌رود — views/sessions دست‌نخورده
  const ua = req.headers.get("user-agent") ?? "";
  if (isBotUa(ua)) {
    return Response.json({ ok: true, counted: false, reason: "BOT" });
  }

  const api = process.env.API_ORIGIN ?? "http://localhost:4000";
  const upstream = await fetch(`${api}/api/v1/analytics/public/visit`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": ua, // فیلتر نهایی و لگ سمت API با UA واقعی کاربر
      "x-forwarded-for": req.headers.get("x-forwarded-for") ?? "", // سقف rate-limit به‌ازای IP واقعی
    },
    body: JSON.stringify({ sessionKey, path }),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);

  // fire-and-forget سمت کلاینت است؛ خطای سرور تجربهٔ خرید را نمی‌شکند
  if (!upstream || !upstream.ok) {
    return Response.json({ ok: false }, { status: 502 });
  }
  const data = (await upstream.json().catch(() => null)) as { counted?: boolean } | null;
  return Response.json({ ok: true, counted: Boolean(data?.counted) });
}
