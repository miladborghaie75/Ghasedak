/**
 * پراکسی سبد سروری — کوکی cart_token را به API می‌فرستد (x-cart-token).
 * GET = خواندن سبد، DELETE = خالی‌کردن کل سبد.
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

export async function GET(req: Request) {
  const upstream = await fetch(`${API}/api/v1/cart`, {
    headers: cartHeaders(req),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch((e) => {
    console.error("[api/cart] GET failed:", e instanceof Error ? e.message : String(e));
    return null;
  });
  if (!upstream) return Response.json({ lines: [], count: 0 }, { status: 502 });
  return Response.json(await upstream.json().catch(() => ({ lines: [], count: 0 })), { status: upstream.status });
}

export async function DELETE(req: Request) {
  const upstream = await fetch(`${API}/api/v1/cart`, {
    method: "DELETE",
    headers: cartHeaders(req),
    signal: AbortSignal.timeout(10_000),
  }).catch((e) => {
    console.error("[api/cart] DELETE failed:", e instanceof Error ? e.message : String(e));
    return null;
  });
  if (!upstream) return Response.json({ lines: [], count: 0 }, { status: 502 });
  return Response.json(await upstream.json().catch(() => ({ lines: [], count: 0 })), { status: upstream.status });
}
