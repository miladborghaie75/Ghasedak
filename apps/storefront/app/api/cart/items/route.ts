/**
 * افزودن/تغییر تعداد یک قلم سبد — پراکسی به API.
 * بدنه: { variantId, qty } — qty<=0 یعنی حذف قلم.
 */
import { COPY } from "@/lib/copy";
import { csrfOk, csrfForbidden } from "@/lib/csrf";

export const dynamic = "force-dynamic";

const API = process.env.API_ORIGIN ?? "http://localhost:4000";

function cartHeaders(req: Request): Record<string, string> {
  const token = req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith("cart_token="))
    ?.slice("cart_token=".length);
  return { "content-type": "application/json", ...(token ? { "x-cart-token": decodeURIComponent(token) } : {}) };
}

export async function POST(req: Request) {
  if (!csrfOk(req)) return csrfForbidden();
  let payload: { variantId?: string; qty?: number } | null = null;
  try {
    payload = (await req.json()) as { variantId?: string; qty?: number } | null;
  } catch {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "درخواست نامعتبر است." } }, { status: 400 });
  }
  if (!payload?.variantId || !Number.isFinite(Number(payload.qty))) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "پارامترهای ناقص." } }, { status: 400 });
  }
  const upstream = await fetch(`${API}/api/v1/cart/items`, {
    method: "POST",
    headers: cartHeaders(req),
    body: JSON.stringify({ variantId: payload.variantId, qty: Number(payload.qty) }),
    signal: AbortSignal.timeout(10_000),
  }).catch((e) => {
    console.error("[api/cart/items] POST failed:", e instanceof Error ? e.message : String(e));
    return null;
  });
  if (!upstream) {
    return Response.json({ error: { code: "API_UNAVAILABLE", message: COPY.cartUnavailable } }, { status: 502 });
  }
  return Response.json(await upstream.json().catch(() => null), { status: upstream.status });
}
