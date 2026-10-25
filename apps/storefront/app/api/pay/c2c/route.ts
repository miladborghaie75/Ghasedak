/**
 * کارت‌به‌کارت (گام ۱۸-۱) — proxy به NestJS API؛ بند ۶: فروشگاه مستقیم
 * به دامنهٔ پرداخت دست نمی‌زند، فقط رد می‌کند.
 *
 * POST: ثبت/اصلاح رسید واریز (فرم مشتری)
 * GET : وضعیت آخرین رسید سفارش (نمایش روی صفحهٔ پرداخت)
 */
import { COPY } from "@/lib/copy";

export const dynamic = "force-dynamic";

/** بررسی double-submit CSRF: هدر `x-csrf-token` باید با کوکی `csrf_token` یکی باشد */
function csrfOk(req: Request): boolean {
  const raw = req.headers.get("cookie") ?? "";
  const m = raw.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  const cookieToken = m ? decodeURIComponent(m[1]) : "";
  const headerToken = req.headers.get("x-csrf-token") ?? "";
  return cookieToken !== "" && headerToken !== "" && cookieToken === headerToken;
}

export async function POST(req: Request) {
  if (!csrfOk(req)) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "CSRF_INVALID",
          message: "نشست این صفحه منقضی شده؛ صفحه را دوباره باز کن و از همان‌جا رسید را ثبت کن.",
        },
      },
      { status: 403 },
    );
  }
  interface C2cPayload {
    orderCode?: string;
    idempotencyKey?: string;
    referenceNo?: string;
    transferDate?: string;
    transferTime?: string;
    sourceBank?: string;
    note?: string;
  }
  let payload: C2cPayload | null = null;
  try {
    payload = (await req.json()) as C2cPayload | null;
  } catch {
    return Response.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: COPY.incompleteRequest } },
      { status: 400 },
    );
  }
  if (!payload?.orderCode || !payload.idempotencyKey) {
    return Response.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "کد سفارش و کلید تلاش لازم است." } },
      { status: 400 },
    );
  }

  const api = process.env.API_ORIGIN ?? "http://localhost:4000";
  const res = await fetch(`${api}/api/v1/payments/c2c/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      orderCode: payload.orderCode,
      idempotencyKey: payload.idempotencyKey,
      referenceNo: payload.referenceNo || undefined,
      transferDate: payload.transferDate || undefined,
      transferTime: payload.transferTime || undefined,
      sourceBank: payload.sourceBank || undefined,
      note: payload.note || undefined,
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as
    | { submissionId?: string; state?: string; code?: string; message?: string }
    | null;

  if (!res || !res.ok) {
    // پیام‌های فارسی سرویس عیناً به مشتری می‌رسد — همان اعتمادِ pay/start
    return Response.json(
      {
        ok: false,
        error: {
          code: body?.code ?? "C2C_SUBMIT_FAILED",
          message: body?.message ?? "ثبت رسید الان ممکن نشد؛ چند لحظه بعد دوباره تلاش کن.",
        },
      },
      { status: res ? res.status : 502 },
    );
  }
  return Response.json({ ok: true, submissionId: body?.submissionId, state: body?.state });
}

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("order");
  if (!code) {
    return Response.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "کد سفارش لازم است." } },
      { status: 400 },
    );
  }
  const api = process.env.API_ORIGIN ?? "http://localhost:4000";
  const res = await fetch(
    `${api}/api/v1/payments/c2c/by-order/${encodeURIComponent(code)}`,
    { cache: "no-store", signal: AbortSignal.timeout(10_000) },
  ).catch(() => null);
  const body = (await res?.json().catch(() => null)) as
    | { state?: string; referenceNo?: string | null; decisionNote?: string | null; code?: string; message?: string }
    | null;

  if (!res) {
    return Response.json(
      { ok: false, error: { code: "UPSTREAM_UNREACHABLE", message: COPY.networkError } },
      { status: 502 },
    );
  }
  if (!res.ok) {
    // ۴۰۰ با NO_SUBMISSION یعنی «هنوز رسیدی نیست» — حالت عادی، نه خطای مشتری
    return Response.json(
      { ok: false, error: { code: body?.code ?? "NO_SUBMISSION", message: body?.message } },
      { status: res.status },
    );
  }
  return Response.json({ ok: true, submission: body });
}
