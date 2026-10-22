/**
 * حذف محصول از علاقه‌مندی سروری — پراکسی به API (بند ۴۲).
 * پارامتر مسیر = id محصول؛ پاسخ فهرست تازهٔ کل علاقه‌مندی‌هاست.
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

export async function DELETE(req: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const upstream = await fetch(`${API}/api/v1/wishlist/items/${encodeURIComponent(productId)}`, {
    method: "DELETE",
    headers: guestHeaders(req),
    signal: AbortSignal.timeout(10_000),
  }).catch((e) => {
    console.error("[api/wishlist/items] DELETE failed:", e instanceof Error ? e.message : String(e));
    return null;
  });
  if (!upstream) {
    return Response.json({ error: { code: "API_UNAVAILABLE", message: COPY.cartUnavailable } }, { status: 502 });
  }
  return Response.json(await upstream.json().catch(() => null), { status: upstream.status });
}
