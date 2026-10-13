/**
 * پراکسی دادهٔ جغرافیایی — استانها و شهرها از API (منبع حقیقت: دیتابیس).
 * فرم checkout استان/شهر را از همین میخواند.
 */
export const dynamic = "force-dynamic";

const API = process.env.API_ORIGIN ?? "http://localhost:4000";

export async function GET() {
  const upstream = await fetch(`${API}/api/v1/geo/provinces`, {
    headers: { "content-type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch((e) => {
    console.error("[api/geo] GET failed:", e instanceof Error ? e.message : String(e));
    return null;
  });
  if (!upstream) return Response.json({ items: [] }, { status: 502 });
  return Response.json(await upstream.json().catch(() => ({ items: [] })), { status: upstream.status });
}
