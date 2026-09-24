/**
 * Proxy بدون دستکاری قیمت — کلاینت فقط sku/qty/آدرس می‌فرستد؛
 * اعتبارسنجی و محاسبه کامل در NestJS API (بند ۵۱/۵۹).
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "درخواست نامعتبر است." } },
      { status: 400 },
    );
  }

  const api = process.env.API_ORIGIN ?? "http://localhost:4000";
  const upstream = await fetch(`${api}/api/v1/orders/checkout`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(req.headers.get("x-idempotency-key")
        ? { "x-idempotency-key": String(req.headers.get("x-idempotency-key")) }
        : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);

  if (!upstream) {
    return Response.json(
      { ok: false, error: { code: "API_UNAVAILABLE", message: "سرویس فروش در دسترس نیست؛ بعداً تلاش کنید." } },
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
      "ثبت سفارش ناموفق بود.";
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
