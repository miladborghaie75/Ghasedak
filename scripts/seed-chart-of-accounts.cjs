/**
 * ساخت حساب‌های تازهٔ فاز ۲ در هر دو دیتابیس.
 *
 * چرا جدا از seed: مهاجرت فقط *ستون‌ها و enum* را می‌سازد (SQL خام)، ولی
 * *ردیف حساب* باید از جدول `CHART_OF_ACCOUNTS` در قرارداد بیاید تا نام و نوع
 * با بقیهٔ سیستم یکی باشد. این اسکریپت همان جدول را upsert می‌کند.
 *
 * بی‌خطر است: `upsert` با `update: {}` حساب‌های موجود را دست نمی‌زند.
 */
const { PrismaClient } = require("@prisma/client");
const { FULL_CHART_OF_ACCOUNTS } = require("@ghasedak/contracts");

(async () => {
  const p = new PrismaClient();

  let created = 0;
  let linked = 0;
  for (const a of FULL_CHART_OF_ACCOUNTS) {
    const existing = await p.account.findUnique({ where: { code: a.code }, select: { id: true, level: true } });
    if (existing) {
      // گروه اصلی = والد ندارد؛ زیرحساب = والدش را پیدا کن
      if (a.level === 2 && a.parent) {
        const parent = await p.account.findUnique({ where: { code: a.parent }, select: { id: true } });
        if (parent && existing.level !== 2) {
          await p.account.update({ where: { code: a.code }, data: { level: 2, parentAccountId: parent.id } });
          linked++;
        }
      }
      continue;
    }
    let parentId = null;
    if (a.level === 2 && a.parent) {
      const parent = await p.account.findUnique({ where: { code: a.parent }, select: { id: true } });
      parentId = parent?.id ?? null;
    }
    await p.account.create({
      data: { code: a.code, name: a.name, type: a.type, level: a.level, parentAccountId: parentId },
    });
    created++;
  }

  const total = await p.account.count();
  const l1 = await p.account.count({ where: { level: 1 } });
  const l2 = await p.account.count({ where: { level: 2 } });
  const orphan = await p.account.count({ where: { level: 2, parentAccountId: null } });
  console.log(`created=${created} linked=${linked} total=${total} (level1=${l1}, level2=${l2}, orphanSub=${orphan})`);
  await p.$disconnect();
})();