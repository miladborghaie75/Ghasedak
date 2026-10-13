/** بازرسی یکپارچگی دفتر — پیش از اعمال قید سخت */
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  console.log("=== ۱) اسناد نامتوازن ===");
  const unbal = await p.$queryRawUnsafe(`
    SELECT e.id, e.number, e.state, e."fiscalYearId",
           COALESCE(SUM(l.debit),0)  AS dr,
           COALESCE(SUM(l.credit),0) AS cr,
           COALESCE(SUM(l.debit),0) - COALESCE(SUM(l.credit),0) AS diff
    FROM "JournalEntry" e
    LEFT JOIN "JournalLine" l ON l."entryId" = e.id
    GROUP BY e.id, e.number, e.state, e."fiscalYearId"
    HAVING COALESCE(SUM(l.debit),0) <> COALESCE(SUM(l.credit),0)
  `);
  if (unbal.length === 0) console.log("  PASS  هیچ سند نامتوازنی نیست");
  else {
    for (const u of unbal) {
      console.log(`  FAIL  ${u.number} (${u.state}) اختلاف=${u.diff}  Dr=${u.dr} Cr=${u.cr}`);
    }
  }

  console.log("\n=== ۲) اسناد بدون خط ===");
  const empty = await p.$queryRawUnsafe(`
    SELECT e.id, e.number FROM "JournalEntry" e
    LEFT JOIN "JournalLine" l ON l."entryId" = e.id
    WHERE l.id IS NULL
  `);
  console.log(empty.length === 0 ? "  PASS  هر سند حداقل یک خط دارد" : `  ${empty.length} سند بدون خط`);

  console.log("\n=== ۳) خطوطی که هر دو طرف دارند یا هیچ‌کدام ===");
  const bad = await p.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n FROM "JournalLine"
    WHERE NOT ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
  `);
  console.log(bad[0].n === 0 ? "  PASS  هر خط دقیقاً یک طرف دارد" : `  FAIL  ${bad[0].n} خط نامعتبر`);

  console.log("\n=== ۴) مقادیر منفی ===");
  const neg = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "JournalLine" WHERE debit < 0 OR credit < 0`,
  );
  console.log(neg[0].n === 0 ? "  PASS  هیچ مبلغ منفی نیست" : `  FAIL  ${neg[0].n} خط منفی`);

  console.log("\n=== ۵) خطوط یتیم (حساب حذف‌شده) ===");
  const orph = await p.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n FROM "JournalLine" l
    LEFT JOIN "Account" a ON a.id = l."accountId" WHERE a.id IS NULL
  `);
  console.log(orph[0].n === 0 ? "  PASS  همهٔ خطوط به حساب معتبر وصل‌اند" : `  FAIL  ${orph[0].n} خط یتیم`);

  console.log("\n=== ۶) تراز کلی ===");
  const t = await p.$queryRawUnsafe(`
    SELECT COALESCE(SUM(debit),0) AS dr, COALESCE(SUM(credit),0) AS cr FROM "JournalLine"
  `);
  const same = String(t[0].dr) === String(t[0].cr);
  console.log(same ? `  PASS  Dr=${t[0].dr} = Cr=${t[0].cr}` : `  FAIL  Dr=${t[0].dr} ≠ Cr=${t[0].cr}`);

  const verdict =
    unbal.length === 0 && empty.length === 0 && bad[0].n === 0 && neg[0].n === 0 && orph[0].n === 0 && same;
  console.log(`\nنتیجه: ${verdict ? "✅ دفتر سالم است — قید سخت قابل اعمال است" : "❌ مشکل وجود دارد"}`);
  await p.$disconnect();
  process.exit(verdict ? 0 : 1);
})();