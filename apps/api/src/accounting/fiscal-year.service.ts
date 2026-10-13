import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { Prisma } from "@prisma/client";

/**
 * سیستم سال مالی — تنها منبع تصمیم دربارهٔ «کدام سال باز است».
 *
 * چرا این سرویس جدا شد:
 *  مسیرهای `createEntryInTx` و `postManual` هر دو سال باز را با
 *  `findFirst({ where: { state: "OPEN" } })` و **بدون orderBy** پیدا می‌کردند.
 *  روی دیتابیس توسعه ۵ سال OPEN هم‌زمان وجود داشت، پس این کوئری آن‌ها را
 *  به ترتیب تصادفی برمی‌گرداند و سندها بین سال‌های مختلف پخش می‌شدند.
 *  چون شمارهٔ سند فقط در محدودهٔ یک سال یکتاست، شماره‌ها تکراری و
 *  بی‌اعتبار می‌شدند.
 *
 * حالا قید دیتابیسی `onlyOneOpenFiscalYear` تضمین می‌کند که بیش از یک سال باز
 *  وجود نداشته باشد، و این سرویس مرتب‌سازی قطعی را هم اضافه می‌کند تا حتی
 *  در صورت حذف قید، رفتار قابل پیش‌بینی بماند.
 *
 * سیاست انتخاب سال برای یک تاریخ مشخص:
 *   ۱. سالی که تاریخ در بازه�اش است (چه باز باشد چه بسته) — حالت عادی
 *   ۲. اگر هیچ سالی آن تاریخ را پوشش نمی‌دهد: سال باز
 *   اگر هیچ‌کدام نبود → خطای روشن، نه رفتار مبهم.
 */
@Injectable()
export class FiscalYearService {
  constructor(private readonly prisma: PrismaService) {}

  /** سال باز — قطعی و مرتب‌شده */
  async openYear(client: PrismaService | Prisma.TransactionClient = this.prisma) {
    return client.fiscalYear.findFirst({
      where: { state: "OPEN" },
      orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
    });
  }

  /**
   * سال مناسب برای یک تاریخ.
   * برای اسناد دستی که کاربر تاریخ انتخاب کرده، سالی که آن تاریخ در بازه‌اش
   * است برگردانده می‌شود تا بشود سندِ سال گذشته را هم (در صورت باز بودن آن سال)
   * ثبت کرد.
   */
  async yearForDate(date: Date, client: PrismaService | Prisma.TransactionClient = this.prisma) {
    const covering = await client.fiscalYear.findFirst({
      where: { startsAt: { lte: date }, endsAt: { gte: date } },
      orderBy: [{ startsAt: "desc" }],
    });
    if (covering) return covering;
    return this.openYear(client);
  }

  /**
   * سال را برمی‌گرداند یا خطای قابل‌فهم می‌دهد.
   *
   * پیام عمداً راهنمایی می‌کند چه باید کرد، چون «سال مالی بازی وجود ندارد»
   * بدون راهنما، کاربر نمی‌داند مشکل از کجاست.
   */
  async requireYear(date?: Date, client: PrismaService | Prisma.TransactionClient = this.prisma) {
    const year = date ? await this.yearForDate(date, client) : await this.openYear(client);
    if (year) return year;

    const closed = await client.fiscalYear.count();
    throw new BadRequestException({
      code: "NO_OPEN_FISCAL_YEAR",
      message:
        closed > 0
          ? "هیچ سال مالی بازی وجود ندارد. از بخش «سال مالی» یک سال جدید بسازید یا سال بسته را باز کنید."
          : "هیچ سال مالی‌ای تعریف نشده است. از بخش «سال مالی» اولین سال را با تاریخ شروع و تراز افتتاحیه بسازید.",
    });
  }

  /** همهٔ سال‌ها، جدیدترین اول — برای صفحهٔ مدیریت */
  list() {
    return this.prisma.fiscalYear.findMany({
      orderBy: [{ startsAt: "desc" }],
      include: { _count: { select: { entries: true } } },
    });
  }

  /**
   * بررسی سلامت سیستم مالی.
   *
   * اضافه بر «سال باز هست؟»، دو چیز دیگر را هم می‌سنجد که هر دو پیش‌تر
   * **پنهان** بودند و باعث گزارش‌های گمراه‌کننده می‌شدند:
   *
   *  ۱) سال‌های بازِ هم‌پوشان — اگر دو سال باز بازهٔ زمانی مشترک داشته باشند،
   *     تاریخ سند مبهم می‌شود. (قید دیتابیسی جلوی *تعداد* را می‌گیرد،
   *     ولی جلوی هم‌پوشانی بازه‌ها را نمی‌گیرد.)
   *  ۲) سالی که هیچ حسابی به `Account` وصل نیست — یعنی seed اجرا نشده و
   *     **همهٔ اسناد خاموش** شکست می‌خورند.
   */
  async health() {
    const years = await this.prisma.fiscalYear.findMany({
      orderBy: [{ startsAt: "desc" }],
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        state: true,
        _count: { select: { entries: true } },
      },
    });
    const open = years.filter((y) => y.state === "OPEN") ?? [];
    const accountCount = await this.prisma.account.count();

    // هم‌پوشانی بازه‌ها بین همهٔ سال‌ها
    const overlaps: Array<{ a: string; b: string }> = [];
    for (let i = 0; i < years.length; i++) {
      for (let j = i + 1; j < years.length; j++) {
        const a = years[i];
        const b = years[j];
        if (a.startsAt < b.endsAt && b.startsAt < a.endsAt) {
          overlaps.push({ a: a.title, b: b.title });
        }
      }
    }

    const problems: string[] = [];
    if (open.length === 0) {
      problems.push(
        years.length > 0
          ? "هیچ سال مالی بازی وجود ندارد — ثبت سند و عملیات مالی کار نمی‌کند."
          : "هیچ سال مالی‌ای تعریف نشده است.",
      );
    }
    if (open.length > 1) {
      problems.push(`${open.length} سال مالی باز هم‌زمان وجود دارد — سندها بین آن‌ها پخش می‌شوند.`);
    }
    if (accountCount === 0) {
      problems.push("هیچ حسابی تعریف نشده — همهٔ اسناد با خطای ACCOUNT_NOT_FOUND رد می‌شوند.");
    }
    if (overlaps.length > 0) {
      problems.push(`${overlaps.length} بازهٔ سال مالی با هم هم‌پوشانی دارند.`);
    }

    return {
      healthy: problems.length === 0,
      problems,
      openYear: open[0] ?? null,
      openCount: open.length,
      accountCount,
      overlaps,
      years: years.map((y) => ({
        id: y.id,
        title: y.title,
        state: y.state,
        startsAt: y.startsAt.toISOString(),
        endsAt: y.endsAt.toISOString(),
        entryCount: y._count.entries,
      })),
    };
  }
}