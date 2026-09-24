import type { Prisma, PrismaClient } from "@prisma/client";
import type { PrismaTransaction } from "./tx";

/**
 * شماره‌گذاری اتمیک اسناد (بند ۴۵): قفل FOR UPDATE روی ردیف سری، پس هیچ دو
 * عملیات هم‌زمان شماره تکراری نمی‌گیرند. سری اگر نبود ساخته می‌شود.
 */
export async function nextNumber(
  tx: PrismaTransaction,
  scope: string,
  prefix: string,
  padding = 6,
): Promise<string> {
  const rows = await tx.$queryRaw<{ nextNumber: number }[]>`
    SELECT "nextNumber" FROM "NumberSeries" WHERE scope = ${scope} FOR UPDATE`;
  let seq = 1;
  if (rows.length === 0) {
    await tx.numberSeries.create({ data: { scope, prefix, nextNumber: 2, padding } });
  } else {
    seq = rows[0].nextNumber;
    await tx.numberSeries.update({
      where: { scope },
      data: { nextNumber: seq + 1 },
    });
  }
  return `${prefix}-${String(seq).padStart(padding, "0")}`;
}
