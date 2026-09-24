/**
 * callback درگاه به فرانت برمی‌گردد؛ این route آن را به API منتقل می‌کند و
 * verify سمت‌سرور را اجرا می‌نماید (بند ۷). هرگز بر اساس پارامتر callback موفق اعلام نمی‌شود.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const authority = url.searchParams.get("Authority") ?? url.searchParams.get("authority") ?? "";
  const status = url.searchParams.get("Status") ?? url.searchParams.get("status") ?? "NOK";
  const origin = url.origin;

  const api = process.env.API_ORIGIN ?? "http://localhost:4000";

  // ثبت callback در API (ثبت، نه تایید)
  await fetch(`${api}/api/v1/payments/callback/zarinpal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ authority, status }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);

  // verify سمت سرور — تنها مرجع تایید
  const verifyRes = await fetch(`${api}/api/v1/payments/verify/${encodeURIComponent(authority)}`, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  const verify = (await verifyRes?.json().catch(() => null)) as
    | { state?: string; refId?: string }
    | null;

  const orderCode = url.searchParams.get("order") ?? "";
  if (verify?.state === "PAID") {
    return Response.redirect(`${origin}/checkout/paid?order=${encodeURIComponent(orderCode)}&ref=${encodeURIComponent(verify.refId ?? "")}`, 302);
  }
  return Response.redirect(`${origin}/checkout/failed?order=${encodeURIComponent(orderCode)}&reason=verify`, 302);
}
