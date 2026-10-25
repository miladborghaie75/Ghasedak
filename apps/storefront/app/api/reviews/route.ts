/**
 * Proxy ثبت نظر مهمان (گام ۱۱) — مرورگر فقط به همین مسیر هم‌مبدأ می‌زند؛
 * اعتبارسنجی کامل (OTP، سهمیه، بج خریدار) سمت NestJS API است (بند ۵۱/۵۹).
 * IP واقعی کلاینت در x-forwarded-for فوروارد می‌شود تا rate-limit سمت API
 * به‌جای «IPِ سرور Next» روی IP واقعی کاربر بنشیند.
 */
import { csrfOk, csrfForbidden } from "@/lib/csrf";

export const dynamic = "force-dynamic";

type Action = "otp-request" | "otp-verify" | "submit";

const ENDPOINTS: Record<Action, string> = {
  "otp-request": "/api/v1/reviews/otp/request",
  "otp-verify": "/api/v1/reviews/otp/verify",
  submit: "/api/v1/reviews/submit",
};

export async function POST(req: Request) {
  if (!csrfOk(req)) {
    return csrfForbidden("نشست این صفحه منقضی شده؛ صفحه را دوباره باز کن و نظرت را ثبت کن.");
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: { code: "VALIDATION_ERROR", message: "درخواست نامعتبر است." } }, { status: 400 });
  }

  const action = String(body.action ?? "") as Action;
  const endpoint = ENDPOINTS[action];
  if (!endpoint) {
    return Response.json({ ok: false, error: { code: "VALIDATION_ERROR", message: "عملیات نامعتبر است." } }, { status: 400 });
  }

  const api = process.env.API_ORIGIN ?? "http://localhost:4000";
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const upstream = await fetch(`${api}${endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(fwd ? { "x-forwarded-for": fwd } : {}),
    },
    body: JSON.stringify(body.payload ?? {}),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);

  if (!upstream) {
    return Response.json(
      { ok: false, error: { code: "API_UNAVAILABLE", message: "سرویس نظرات در دسترس نیست؛ کمی بعد تلاش کن." } },
      { status: 502 },
    );
  }

  const data = (await upstream.json().catch(() => null)) as unknown;
  return Response.json({ ok: upstream.ok, ...(data as object) }, { status: upstream.status });
}
