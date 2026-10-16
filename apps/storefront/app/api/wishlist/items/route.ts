/**
 * افزودن محصول به علاقه‌مندی سروری — پراکسی به API (بند ۴۲).
 * بدنه: { productId } — idempotent؛ پاسخ فهرست تازهٔ کل علاقه‌مندی‌هاست.
 */
import { COPY } from "@/lib/copy";

export const dynamic = "force-dynamic";

const API = process.env.API_ORIGIN ?? "http://localhost:4000";

function guestHeaders(req: Request): Record<string, string> {
  const token = req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith("cart_token="))
    ?.slice("cart_token=".length);
  return { "content-type": "application/json", ...(token ? { "x-cart-token": decodeURIComponent(token) } : {}) };
}

export async function POST(req: Request) {
  let payload: { productId?: string } | null = null;
  try {
    payload = (await req.json()) as { productId?: string } | null;
  } catch {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "درخواست نامعتبر است." } }, { status: 400 });
  }
  if (!payload?.productId) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "پارامترهای ناقص." } }, { status: 400 });
  }
  const upstream = await fetch(`${API}/api/v1/wishlist/items`, {
    method: "POST",
    headers: guestHeaders(req),
    body: JSON.stringify({ productId: payload.productId }),
    signal: AbortSignal.timeout(10_000),
  }).catch((e) => {
    console.error("[api/wishlist/items] POST failed:", e instanceof Error ? e.message : String(e));
    return null;
  });
  if (!upstream) {
    return Response.json({ error: { code: "API_UNAVAILABLE", message: COPY.cartUnavailable } }, { status: 502 });
  }
  return Response.json(await upstream.json().catch(() => null), { status: upstream.status });
}
