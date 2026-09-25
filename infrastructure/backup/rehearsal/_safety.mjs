/**
 * _safety.mjs — گارد مشترک ابزارهای rehearsal/recovery.
 * fail-safe: اتصال به primary (5433) یا دیتابیس اصلی ghasedak را رد می‌کند.
 */
export function assertSafeUrl(url, { label = "connection" } = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    console.error(`REFUSED (${label}): invalid connection URL`);
    process.exit(3);
  }
  const port = u.port || "5432";
  const dbname = u.pathname.replace(/^\//, "");
  if (port === "5433") {
    console.error(`REFUSED (${label}): port 5433 is the PRIMARY — rehearsal tools never touch it`);
    process.exit(3);
  }
  if (dbname === "ghasedak") {
    console.error(`REFUSED (${label}): database 'ghasedak' is the PRIMARY database — use a rehearsal/baseline database name`);
    process.exit(3);
  }
  return url;
}
