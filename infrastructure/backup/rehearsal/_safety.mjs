/**
 * _safety.mjs — گارد مشترک ابزارهای rehearsal/recovery.
 * fail-safe: اتصال به primary (5433) یا دیتابیس اصلی ghasedak را رد می‌کند.
 *
 * Override صریح برای Production Recovery:
 *   REHEARSAL_ALLOW_PRIMARY=1
 *   REHEARSAL_PRIMARY_SYSTEM_IDENTIFIER=7688682880612306664
 *
 * فقط وقتی اجازهٔ اتصال به primary داده می‌شود که:
 *   1) مقدار override دقیقاً "1" باشد؛
 *   2) مقصد دقیقاً localhost:5433/ghasedak باشد؛
 *   3) system_identifier مورد انتظار به‌صورت صریح در env پاس شده باشد
 *      (این مقدار باید قبل از هر mutation از خود primary خوانده و تطبیق داده شده باشد).
 *
 * بدون override، primary همچنان REFUSE می‌شود. گارد عمومی حذف نشده و
 * مقصدهای اشتباه حتی با override هم رد می‌شوند.
 */
export const APPROVED_PRIMARY = {
  host: "localhost",
  port: "5433",
  database: "ghasedak",
  systemIdentifier: "7688682880612306664",
};

export function assertSafeUrl(url, { label = "connection" } = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    console.error(`REFUSED (${label}): invalid connection URL`);
    process.exit(3);
  }
  const host = (u.hostname || "").toLowerCase();
  const port = u.port || "5432";
  const dbname = u.pathname.replace(/^\//, "");

  const exactPrimary = host === "localhost" && port === "5433" && dbname === "ghasedak";
  const primaryServer = port === "5433";
  const override = process.env.REHEARSAL_ALLOW_PRIMARY;

  if (primaryServer) {
    // پورت 5433 = سرور primary. فقط مقصد دقیق localhost:5433/ghasedak با override معتبر مجاز است؛
    // هر db دیگری روی همین سرور حتی با override رد می‌شود.
    const overrideOk = override === "1";
    const expectedSid = (process.env.REHEARSAL_PRIMARY_SYSTEM_IDENTIFIER ?? "").trim();
    const sidOk = expectedSid === APPROVED_PRIMARY.systemIdentifier;
    if (!exactPrimary) {
      console.error(`REFUSED (${label}): port 5433 is the PRIMARY server and '${dbname}' is not the exact approved target — override only covers localhost:5433/ghasedak`);
      process.exit(3);
    }
    if (!overrideOk || !sidOk) {
      console.error(`REFUSED (${label}): port 5433 / database 'ghasedak' is the PRIMARY — rehearsal tools never touch it`);
      if (overrideOk && !sidOk) {
        console.error(`REFUSED (${label}): REHEARSAL_ALLOW_PRIMARY=1 set but system_identifier check failed (set REHEARSAL_PRIMARY_SYSTEM_IDENTIFIER=${APPROVED_PRIMARY.systemIdentifier} after reading it from the live primary)`);
      }
      process.exit(3);
    }
    console.warn(
      `*** PRIMARY OVERRIDE ACTIVE (${label}): connecting to PRODUCTION PRIMARY ${host}:${port}/${dbname} — destructive recovery tool, per Final Production Recovery Gate approval ***`,
    );
    return url;
  }

  // مقصد غیر primary: رفتار قبلی حفظ شود (db اصلی ghasedak روی پورت دیگر هم رد شود)
  if (dbname === "ghasedak") {
    console.error(`REFUSED (${label}): database 'ghasedak' is the PRIMARY database — use a rehearsal/baseline database name`);
    process.exit(3);
  }
  return url;
}
