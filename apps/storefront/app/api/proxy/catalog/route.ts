/**
 * Proxy کاتالوگ برای کلاینت — بدون دستکاری داده (بند ۵۱).
 * کلاینت از ensureCatalogClient می‌آید؛ این فقط از API اصلی passthrough می‌کند.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const api = process.env.API_ORIGIN ?? "http://localhost:4000";
  const out: Array<Record<string, unknown>> = [];
  try {
    for (let page = 1; page <= 10; page++) {
      const res = await fetch(`${api}/api/v1/catalog/products?per_page=100&page=${page}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) break;
      const body = (await res.json()) as { items: Array<Record<string, unknown>>; hasMore: boolean };
      out.push(...body.items);
      if (!body.hasMore) break;
    }
  } catch {
    // آفلاین — خالی
  }
  return Response.json(
    { items: out },
    { headers: { "cache-control": "no-store" } },
  );
}
