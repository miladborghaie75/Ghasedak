/**
 * انتقال حساب‌های بانکی موجود از حساب گروهی `1100` به زیرحساب مستقل.
 *
 * چرا لازم است: کاربر گزینهٔ «الف» را انتخاب کرد — هر بانک حساب دفتری
 * خودش. ولی حساب‌هایی که **قبلاً** ساخته شده‌اند همگی روی `1100` گروهی
 * نشسته‌اند، یعنی در عمل تفکیکی که خواسته شده وجود ندارد و مغایرت‌گیری بانکی
 * همهٔ بانک‌ها را قاطی می‌بیند.
 *
 * این اسکریپت فقط بانک‌هایی را جابه‌جا می‌کند که:
 *   • روی خودِ گروه `1100` هستند (نه زیرحساب)
 *   • و زیرحساب آزاد برایشان وجود دارد
 * ماندهٔ دفتری قبلی حفظ می‌شود (هیچ سندی دست نمی‌خورد).
 */
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  const group = await p.account.findUnique({ where: { code: "1100" }, select: { id: true } });
  if (!group) {
    console.log("حساب 1100 یافت نشد");
    await p.$disconnect();
    process.exit(1);
  }

  const onGroup = await p.bankAccount.findMany({
    where: { glAccountId: group.id },
    select: { id: true, name: true, accountNumber: true, currentBalance: true },
    orderBy: { name: "asc" },
  });
  console.log(`بانک‌های روی گروه ۱۱۰۰: ${onGroup.length}`);

  const freeSubs = await p.account.findMany({
    where: { parentAccountId: group.id },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });
  // فقط زیرحساب‌هایی که هنوز بانکی به آن‌ها وصل نیست
  const usedIds = new Set(
    (await p.bankAccount.findMany({ where: { glAccountId: { in: freeSubs.map((s) => s.id) } }, select: { glAccountId: true } })).map(
      (b) => b.glAccountId,
    ),
  );
  const available = freeSubs.filter((s) => !usedIds.has(s.id));
  console.log(`زیرحساب آزاد: ${available.length}`);

  let moved = 0;
  for (const b of onGroup) {
    const target = available[moved];
    if (!target) {
      console.log(`  ! زیرحساب آزادی نماند برای «${b.name}»`);
      break;
    }
    await p.bankAccount.update({ where: { id: b.id }, data: { glAccountId: target.id } });
    console.log(`  «${b.name}» → ${target.code}`);
    moved++;
  }

  const after = await p.bankAccount.findMany({
    select: { name: true, account: { select: { code: true } } },
    orderBy: { name: "asc" },
  });
  console.log("\nنتیجه:");
  for (const b of after) console.log(`  ${b.name} → GL ${b.account?.code}`);
  const distinct = new Set(after.map((b) => b.account?.code)).size;
  console.log(`\nحساب دفتری یکتا: ${distinct} از ${after.length} بانک`);

  await p.$disconnect();
})();