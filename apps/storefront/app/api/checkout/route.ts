/**
 * Proxy بدون دستکاری قیمت — کلاینت فقط sku/qty/آدرس می‌فرستد؛
 * اعتبارسنجی و محاسبه کامل در NestJS API (بند ۵۱/۵۹).
 */
import { COPY } from "@/lib/copy";
import { getMaintenance } from "@/lib/maintenance";
import { csrfOk } from "@/lib/csrf";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // حالت تعمیر (گام ۱۰): حتی اگر رابط بسته نشده باشد، ثبت سفارش در تعمیر ممنوع است
  if ((await getMaintenance()).enabled) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "MAINTENANCE",
          message: "فروشگاه دموتازه است و سفارش‌گیری موقتاً بسته است؛ کمی بعد دوباره تلاش کن.",
        },
      },
      { status: 503 },
    );
  }
  if (!csrfOk(req)) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "CSRF_INVALID",
          message: "نشست این صفحه منقضی شده؛ صفحه را دوباره باز کن و سفارش را ثبت کن.",
        },
      },
      { status: 403 },
    );
  }
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: COPY.incompleteRequest } },
      { status: 400 },
    );
  }

  const api = process.env.API_ORIGIN ?? "http://localhost:4000";

  // کلید ضدتکرار: اگر کلاینت نداد، سمت‌سرور ساخته می‌شود و در بدنه هم تزریق می‌گردد
  const idem = String(req.headers.get("x-idempotency-key") ?? "") || crypto.randomUUID();
  const bodyObj =
    payload && typeof payload === "object"
      ? { ...(payload as Record<string, unknown>), idempotencyKey: (payload as { idempotencyKey?: string }).idempotencyKey ?? idem }
      : payload;

  const upstream = await fetch(`${api}/api/v1/orders/checkout`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-idempotency-key": idem,
    },
    body: JSON.stringify(bodyObj),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);

  if (!upstream) {
    return Response.json(
      { ok: false, error: { code: "API_UNAVAILABLE", message: "سرویس فروش در دسترس نیست؛ چند دقیقه بعد دوباره تلاش کن." } },
      { status: 502 },
    );
  }

  const body = (await upstream.json().catch(() => null)) as
    | { code?: string; total?: string | number; id?: string }
    | null;

  if (!upstream.ok || !body?.code) {
    const msg =
      (body as unknown as { message?: string; error?: { message?: string } } | null)?.error?.message ??
      (body as unknown as { message?: string } | null)?.message ??
      "ثبت سفارش ناموفق بود؛ دوباره تلاش کن.";
    return Response.json({ ok: false, error: { code: "CHECKOUT_FAILED", message: msg } }, { status: upstream.status });
  }

  // پاسخ: redirect به صفحه پرداخت mock (dev) — زرین‌پال با credential واقعی فعال می‌شود
  return Response.json({
    ok: true,
    orderCode: body.code,
    total: body.total,
    redirectUrl: `/checkout/pay?order=${encodeURIComponent(body.code)}`,
  });
}
