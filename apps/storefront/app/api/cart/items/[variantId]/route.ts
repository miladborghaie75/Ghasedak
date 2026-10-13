/**
 * حذف یک قلم از سبد — پراکسی به API.
 * پارامتر مسیر = SKU (همان شناسه‌ای که کلاینت «variantId» می‌نامد).
 */
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

export async function DELETE(req: Request, { params }: { params: Promise<{ variantId: string }> }) {
  const { variantId } = await params;
  const upstream = await fetch(`${API}/api/v1/cart/items/${encodeURIComponent(variantId)}`, {
    method: "DELETE",
    headers: cartHeaders(req),
    signal: AbortSignal.timeout(10_000),
  }).catch((e) => {
    console.error("[api/cart/items] DELETE failed:", e instanceof Error ? e.message : String(e));
    return null;
  });
  if (!upstream) {
    return Response.json({ error: { code: "API_UNAVAILABLE", message: "سرویس سبد در دسترس نیست." } }, { status: 502 });
  }
  return Response.json(await upstream.json().catch(() => null), { status: upstream.status });
}
