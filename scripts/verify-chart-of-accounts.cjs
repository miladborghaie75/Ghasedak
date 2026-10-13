/** بررسی کدینگ درختی — ساختار و توازن */
const { PrismaClient } = require("@prisma/client");
const { FULL_CHART_OF_ACCOUNTS, temporaryGroupCodes, isTemporaryAccount } = require("@ghasedak/contracts");
const p = new PrismaClient();

(async () => {
  const db = await p.account.findMany({
    orderBy: { code: "asc" },
    select: { code: true, name: true, type: true, level: true, parentAccountId: true, parent: { select: { code: true } } },
  });
  const byCode = new Map(db.map((a) => [a.code, a]));

  console.log("total accounts:", db.length);
  const l1 = db.filter((a) => a.level === 1);
  const l2 = db.filter((a) => a.level === 2);
  console.log("level 1 (گروه‌ها):", l1.length, "| level 2 (زیرحساب‌ها):", l2.length);

  console.log("\n--- گروه‌های هزینه/درآمد و زیرحساب‌هایشان ---");
  for (const g of ["4000", "5000", "6000"]) {
    const grp = byCode.get(g);
    console.log(`\n  ${g} ${grp?.name} (${grp?.type})`);
    for (const s of db.filter((x) => x.parent?.code === g)) {
      console.log(`    └─ ${s.code}  ${s.name}  [${s.type}]`);
    }
  }

  console.log("\n--- بررسی والد هر زیرحساب ---");
  let bad = 0;
  for (const s of l2) {
    if (!s.parent) {
      console.log(`  ?? زیرحساب بدون والد: ${s.code}`);
      bad++;
    }
  }
  console.log(bad === 0 ? "  PASS  همهٔ زیرحساب‌ها والد دارند" : `  FAIL  ${bad} مورد`);

  console.log("\n--- توافق با منبع واحد ---");
  let mismatch = 0;
  for (const a of db) {
    const def = FULL_CHART_OF_ACCOUNTS.find((x) => x.code === a.code);
    if (!def) {
      console.log(`  ?? کد ناشناس در DB: ${a.code}`);
      mismatch++;
    } else if (def.name !== a.name || def.type !== a.type) {
      console.log(`  ?? ناهماهنگی ${a.code}: DB="${a.name}" vs src="${def.name}"`);
      mismatch++;
    }
  }
  console.log(mismatch === 0 ? "  PASS  همهٔ حساب‌ها با منبع واحد مطابق‌اند" : `  FAIL  ${mismatch}`);

  console.log("\n--- حساب‌های موقت برای سند اختتامیه ---");
  console.log("  گروه‌های موقت:", temporaryGroupCodes().join(", "));
  console.log("  6000-01 موقت است؟", isTemporaryAccount("6000-01"), "(باید true باشد)");

  console.log("\n--- آیا اسناد موجود سالم‌اند؟ ---");
  const orphanLines = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "JournalLine" jl
     LEFT JOIN "Account" a ON a.id = jl."accountId" WHERE a.id IS NULL`,
  );
  console.log(orphanLines[0].n === 0 ? "  PASS  هیچ خط سندی حساب یتیم ندارد" : `  FAIL  ${orphanLines[0].n} خط یتیم`);
  const lines = await p.journalLine.count();
  console.log(`  خطوط سند موجود: ${lines}`);

  await p.$disconnect();
})();