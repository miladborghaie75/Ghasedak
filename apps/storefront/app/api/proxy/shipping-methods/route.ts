/**
 * Proxy روش‌های ارسال برای کلاینت checkout — passthrough از API اصلی (بند ۵۱).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const api = process.env.API_ORIGIN ?? "http://localhost:4000";
  try {
    const res = await fetch(`${api}/api/v1/shipping/methods`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as Array<Record<string, unknown>>;
    return Response.json({ items: Array.isArray(body) ? body : [] }, { headers: { "cache-control": "no-store" } });
  } catch {
    // آفلاین — خالی؛ UI گزینهٔ پیش‌فرض دارد
    return Response.json({ items: [] }, { headers: { "cache-control": "no-store" } });
  }
}
