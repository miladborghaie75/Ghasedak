/**
 * اثبات نهایی قید توازن (فاز ۰٫۴)
 *
 * دو چیز را هم‌زمان می‌سنجد:
 *  ۱) راه‌های دور زدن بسته شده‌اند
 *  ۲) مسیر عادی ساخت سند هنوز کار می‌کند (بی‌موردی سخت‌گیری نکرده‌ایم)
 */
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

let pass = 0;
let fail = 0;
const ok = (l) => { console.log(`  PASS  ${l}`); pass++; };
const bad = (l) => { console.log(`  FAIL  ${l}`); fail++; };

const isBlocked = (e) => {
  const m = String(e?.meta?.message ?? e?.message ?? "");
  return /نامتوازن|check_violation|JournalLine_/.test(m);
};

(async () => {
  console.log("=== سلامت اولیه ===");
  const start = await p.$queryRawUnsafe(
    `SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c FROM "JournalLine"`,
  );
  String(start[0].d) === String(start[0].c) ? ok("دفتر متوازن است") : bad("دفتر نامتوازن از قبل");

  const two = await p.$queryRawUnsafe(
    `SELECT e.id FROM "JournalEntry" e
     WHERE (SELECT COUNT(*) FROM "JournalLine" l WHERE l."entryId"=e.id) >= 2 LIMIT 1`,
  );
  if (two.length === 0) { console.log("سند دولاینی برای آزمون نیست"); await p.$disconnect(); process.exit(1); }
  const eid = two[0].id;

  console.log("\n=== ۱) راه‌های دور زدن باید بسته باشند ===");

  // الف) UPDATE روی خط موجود
  try {
    await p.$executeRawUnsafe(
      `UPDATE "JournalLine" SET debit = debit + 111
       WHERE id = (SELECT id FROM "JournalLine" WHERE "entryId"=$1 AND credit=0 LIMIT 1)`,
      eid,
    );
    bad("UPDATE روی خط موجود رد نشد");
    await p.$executeRawUnsafe(
      `UPDATE "JournalLine" SET debit = debit - 111
       WHERE id = (SELECT id FROM "JournalLine" WHERE "entryId"=$1 AND credit=0 ORDER BY debit ASC LIMIT 1)`,
      eid,
    );
  } catch (e) {
    isBlocked(e) ? ok("UPDATE روی خط موجود رد شد") : bad("UPDATE خطای دیگر داد");
  }

  // ب) UPDATE مقدار credit روی خط بدهکار
  try {
    await p.$executeRawUnsafe(
      `UPDATE "JournalLine" SET credit = 500 WHERE id = (SELECT id FROM "JournalLine" WHERE "entryId"=$1 AND debit>0 LIMIT 1)`,
      eid,
    );
    bad("تبدیل خط بدهکار به بستانکار رد نشد");
    await p.$executeRawUnsafe(
      `UPDATE "JournalLine" SET credit = 0 WHERE id = (SELECT id FROM "JournalLine" WHERE "entryId"=$1 AND debit>0 LIMIT 1)`,
      eid,
    );
  } catch (e) {
    isBlocked(e) ? ok("تبدیل خط بدهکار به بستانکار رد شد") : bad("خطای دیگر");
  }

  // پ) DELETE که سند را نامتوازن می‌کند
  try {
    const del = await p.$queryRawUnsafe(
      `SELECT id FROM "JournalLine" WHERE "entryId"=$1 AND debit>0 LIMIT 1`,
      eid,
    );
    if (del.length) {
      await p.$executeRawUnsafe(`DELETE FROM "JournalLine" WHERE id=$1`, del[0].id);
      bad("DELETE خط بدهکار رد نشد");
      await p.$executeRawUnsafe(
        `INSERT INTO "JournalLine" (id,"entryId","accountId",debit,credit)
         SELECT $1, "entryId", "accountId", debit, credit FROM "JournalLine"
         WHERE "entryId"=$2 LIMIT 1`,
        del[0].id,
        eid,
      );
    }
  } catch (e) {
    isBlocked(e) ? ok("DELETE که سند را نامتوازن می‌کرد رد شد") : bad("خطای دیگر");
  }

  console.log("\n=== ۲) قیدهای سطری ===");
  const cons = await p.$queryRawUnsafe(
    `SELECT conname FROM pg_constraint WHERE conrelid='"JournalLine"'::regclass AND contype='c'`,
  );
  const names = cons.map((c) => c.conname);
  names.includes("JournalLine_one_side_only") ? ok("قید یک-طرفه‌بودن هست") : bad("قید یک-طرفه‌بودن نیست");
  names.includes("JournalLine_non_negative") ? ok("قید غیرمنفی هست") : bad("قید غیرمنفی نیست");

  console.log("\n=== ۳) مسیر عادی ساخت سند باید کار کند ===");
  const acc = await p.$queryRawUnsafe(`SELECT id FROM "Account" WHERE code='1000' LIMIT 1`);
  const fy = await p.$queryRawUnsafe(`SELECT id FROM "FiscalYear" WHERE state='OPEN' LIMIT 1`);
  const tmpEntry = "tmp-probe-" + Date.now();
  const tmpNum = "TMP-" + Date.now();
  try {
    // سند موقت لازم است — JournalLine به JournalEntry کلید خارجی دارد
    await p.$executeRawUnsafe(
      `INSERT INTO "JournalEntry" (id, number, "fiscalYearId", date, state, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), 'FINAL', NOW(), NOW())`,
      tmpEntry,
      tmpNum,
      fy[0].id,
    );
    await p.$executeRawUnsafe(
      `INSERT INTO "JournalLine" (id,"entryId","accountId",debit,credit) VALUES ($1,$2,$3,100,0)`,
      "l1-" + tmpEntry,
      tmpEntry,
      acc[0].id,
    );
    ok("اولین خط سند تازه درج شد (ساخت آزاد است)");
    await p.$executeRawUnsafe(
      `INSERT INTO "JournalLine" (id,"entryId","accountId",debit,credit) VALUES ($1,$2,$3,0,100)`,
      "l2-" + tmpEntry,
      tmpEntry,
      acc[0].id,
    );
    ok("خط دوم درج شد و سند متوازن است");
    await p.$executeRawUnsafe(`DELETE FROM "JournalEntry" WHERE id=$1`, tmpEntry);
    ok("پاک‌سازی آزمون (حذف آبشاری خطوط)");
  } catch (e) {
    bad("ساخت سند جدید رد شد: " + String(e?.meta?.message ?? e?.message).slice(0, 110));
    await p.$executeRawUnsafe(`DELETE FROM "JournalEntry" WHERE id=$1`, tmpEntry).catch(() => null);
  }

  console.log("\n=== ۴) دفتر در نهایت سالم است ===");
  const bad2 = await p.$queryRawUnsafe(`
    SELECT e.number, COALESCE(SUM(l.debit),0)-COALESCE(SUM(l.credit),0) AS diff
    FROM "JournalEntry" e LEFT JOIN "JournalLine" l ON l."entryId"=e.id
    GROUP BY e.id, e.number HAVING COALESCE(SUM(l.debit),0) <> COALESCE(SUM(l.credit),0)`);
  bad2.length === 0 ? ok("هیچ سند نامتوازنی نیست") : bad(`${bad2.length} سند نامتوازن: ${bad2.map((x) => x.number).join(", ")}`);
  const fin = await p.$queryRawUnsafe(
    `SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c FROM "JournalLine"`,
  );
  String(fin[0].d) === String(fin[0].c) ? ok(`تراز کلی: Dr=${fin[0].d} = Cr=${fin[0].c}`) : bad("تراز کلی نامتوازن");

  console.log(`\n${"=".repeat(50)}`);
  console.log(`نتیجه: ${pass} موفق / ${fail} ناموفق`);
  console.log("=".repeat(50));
  await p.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
})();