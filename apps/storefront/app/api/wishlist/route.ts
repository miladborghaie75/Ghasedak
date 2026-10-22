/**
 * پراکسی علاقه‌مندی سروری (بند ۴۲) — کوکی cart_token را به API می‌فرستد
 * (x-cart-token)؛ همان هویت ناشناس سبد، این‌بار برای علاقه‌مندی.
 * GET = خواندن فهرست id محصولات.
 */
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

export async function GET(req: Request) {
  const upstream = await fetch(`${API}/api/v1/wishlist`, {
    headers: guestHeaders(req),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch((e) => {
    console.error("[api/wishlist] GET failed:", e instanceof Error ? e.message : String(e));
    return null;
  });
  if (!upstream) return Response.json({ productIds: [] }, { status: 502 });
  return Response.json(await upstream.json().catch(() => ({ productIds: [] })), { status: upstream.status });
}
