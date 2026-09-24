/**
 * شروع پرداخت آنلاین — proxy به NestJS API؛
 * resolver سفارش (code → id) و ایجاد PaymentAttempt سمت API است (بند ۶/۱۰).
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let payload: { orderCode?: string; idempotencyKey?: string } | null = null;
  try {
    payload = (await req.json()) as { orderCode?: string; idempotencyKey?: string } | null;
  } catch {
    return Response.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "درخواست نامعتبر است." } },
      { status: 400 },
    );
  }
  if (!payload?.orderCode || !payload.idempotencyKey) {
    return Response.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "پارامترهای ناقص." } },
      { status: 400 },
    );
  }

  const api = process.env.API_ORIGIN ?? "http://localhost:4000";

  // 1) سفارش را با code واکشی و orderId/methodId را resolve کن
  const orderRes = await fetch(`${api}/api/v1/orders/by-code/${encodeURIComponent(payload.orderCode)}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  const order = (await orderRes?.json().catch(() => null)) as
    | { id?: string; paymentStatus?: string }
    | null;

  if (!orderRes || !orderRes.ok || !order?.id) {
    return Response.json(
      { ok: false, error: { code: "NOT_FOUND", message: "سفارش یافت نشد." } },
      { status: 404 },
    );
  }
  if (order.paymentStatus === "PAID") {
    return Response.json(
      { ok: false, error: { code: "ORDER_PAID", message: "این سفارش قبلاً پرداخت شده است." } },
      { status: 409 },
    );
  }

  // 2) روش پرداخت آنلاین فعال
  const methodsRes = await fetch(`${api}/api/v1/payments/methods`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  const methods = (await methodsRes?.json().catch(() => null)) as
    | Array<{ id?: string; code?: string }>
    | null;
  const online = Array.isArray(methods) ? methods.find((m) => m.code === "online") : null;

  // 3) ایجاد attempt + redirect
  const startRes = await fetch(`${api}/api/v1/payments/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      orderId: order.id,
      methodId: online?.id,
      idempotencyKey: payload.idempotencyKey,
      callbackUrl: `${new URL(req.url).origin}/api/pay/callback`,
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => { });
  const start = (await startRes?.json().catch(() => null)) as
    | { attemptId?: string; redirectUrl?: string; message?: string }
    | null;

  if (!startRes || !startRes.ok || !start?.redirectUrl) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "PAYMENT_START_FAILED",
          message: start?.message ?? "درگاه پرداخت در دسترس نیست؛ بعداً تلاش کنید.",
        },
      },
      { status: 502 },
    );
  }

  return Response.json({ ok: true, redirectUrl: start.redirectUrl, attemptId: start.attemptId });
}
