import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { FiscalYearService } from "./fiscal-year.service";
import { JournalService } from "./journal.service";
import { RequirePermission } from "../auth/permissions.guard";
import { Identity } from "../auth/identity.decorator";
import { GL_EQUITY, temporaryGroupCodes } from "@ghasedak/contracts";

/**
 * مدیریت سال مالی — بند ۴۴–۵۸
 *
 * تصمیم کاربر: سال مالی از روزی شروع می‌شود که سایت روی هاست می‌رود و
 * اولین اقلام ثبت می‌شود، با تراز افتتاحیه. یک سال بعد تراز اختتامیه می‌خورد
 * و تراز افتتاحیهٔ سال بعد بسته می‌شود. چون تاریخ شروع هنوز معلوم نیست،
 * سال باید از پنل و با تاریخ دلخواه ساخته شود.
 */
@Controller("admin/accounting/fiscal-year")
export class FiscalYearController {
  constructor(
    private readonly svc: FiscalYearService,
    private readonly prisma: PrismaService,
    private readonly journal: JournalService,
  ) {}

  /**
   * بررسی سلامت سیستم مالی — بیشتر برای صفحهٔ «تنظیمات/تشخیص».
   * هر چیزی که در `problems` بیاید، قبلاً باعث رفتار خاموش و گمراه‌کننده
   * می‌شد (اسناد بی‌صدا حذف می‌شدند یا روی سال اشتباه می‌نشستند).
   */
  @Get("health")
  @RequirePermission("accounting.view")
  async health() {
    return this.svc.health();
  }

  /** فهرست سال‌ها — جدیدترین اول */
  @Get()
  @RequirePermission("accounting.view")
  async list() {
    const rows = await this.svc.list();
    return {
      items: rows.map((y) => ({
        id: y.id,
        title: y.title,
        startsAt: y.startsAt.toISOString(),
        endsAt: y.endsAt.toISOString(),
        state: y.state,
        entryCount: y._count.entries,
        closedAt: y.closedAt?.toISOString() ?? null,
        reopenedAt: y.reopenedAt?.toISOString() ?? null,
      })),
      openId: rows.find((y) => y.state === "OPEN")?.id ?? null,
    };
  }

  /**
   * ساخت سال مالی جدید.
   *
   * اگر سالی باز باشد، آن را می‌بندیم و سال تازه را باز می‌کنیم — چون
   * قید دیتابیسی اجازهٔ دو سال باز نمی‌دهد و کاربر معمولاً می‌خواهد
   * «سال را جلو ببرد».
   *
   * `openingLines` اختیاری است: اگر داده شود، همان لحظه **تراز افتتاحیه**
   * به‌صورت یک سند ثبت می‌شود.
   */
  @Post()
  @RequirePermission("accounting.journal")
  async create(
    @Body()
    body: {
      title: string;
      startsAt: string;
      endsAt?: string;
      /** یک سال بعد، اگر endsAt داده نشود */
      months?: number;
      openingLines?: Array<{ accountCode: string; debit?: number; credit?: number }>;
      /** جایگزینی سال باز فعلی — پیش‌فرض true */
      closeCurrent?: boolean;
    },
    @Identity() actor?: { userId: string },
  ) {
    const title = String(body.title ?? "").trim();
    if (!title) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "عنوان سال الزامی است." });

    const startsAt = new Date(body.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "تاریخ شروع نامعتبر است." });
    }

    // پایان پیش‌فرض: دقیقاً یک سال بعد (۱۲ ماه) — تصمیم کاربر
    const months = Number.isFinite(Number(body.months)) && Number(body.months) > 0 ? Number(body.months) : 12;
    const endsAt = body.endsAt ? new Date(body.endsAt) : addMonths(startsAt, months);
    if (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "تاریخ پایان باید بعد از تاریخ شروع باشد.",
      });
    }

    const existingOpen = await this.svc.openYear();
    if (existingOpen && body.closeCurrent === false) {
      throw new BadRequestException({
        code: "FISCAL_YEAR_ALREADY_OPEN",
        message: `سال «${existingOpen.title}» باز است. برای ادامه، ابتدا آن را ببندید یا اجازهٔ بستنش را بدهید.`,
      });
    }

    // سالی که تاریخ‌هایش با سال تازه هم‌پوشانی دارد نباید وجود داشته باشد
    const overlap = await this.prisma.fiscalYear.findFirst({
      where: { startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
    });
    if (overlap) {
      throw new BadRequestException({
        code: "FISCAL_YEAR_OVERLAP",
        message: `بازهٔ انتخابی با سال «${overlap.title}» هم‌پوشانی دارد.`,
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      // بستن سال باز قبلی — قید یکتا اجازه نمی‌دهد هر دو باز باشند
      if (existingOpen && body.closeCurrent !== false) {
        await tx.fiscalYear.update({
          where: { id: existingOpen.id },
          data: { state: "LOCKED", closedAt: new Date(), closedById: actor?.userId ?? null },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor?.userId ?? null,
            action: "accounting.fiscal_year.lock",
            entity: "FiscalYear",
            entityId: existingOpen.id,
            newValues: { reason: "opening_new_year" } as object,
          },
        });
      }

      const year = await tx.fiscalYear.create({
        data: { title, startsAt, endsAt, state: "OPEN" },
      });

      // تراز افتتاحیه — فقط اگر خطوطی داده شده باشد
      if (body.openingLines && body.openingLines.length > 0) {
        const rows = body.openingLines
          .map((l) => ({
            accountCode: String(l.accountCode ?? ""),
            debit: Number(l.debit ?? 0),
            credit: Number(l.credit ?? 0),
          }))
          .filter((l) => l.accountCode && (l.debit !== 0 || l.credit !== 0));
        if (rows.length >= 2) {
          const dr = rows.reduce((s, l) => s + l.debit, 0);
          const cr = rows.reduce((s, l) => s + l.credit, 0);
          if (dr !== cr) {
            throw new BadRequestException({
              code: "OPENING_UNBALANCED",
              message: `تراز افتتاحیه متوازن نیست (بدهکار ${dr} / بستانکار ${cr}).`,
            });
          }
          await this.journal.postInTx(tx, {
            description: `تراز افتتاحیه ${title}`,
            sourceType: "opening",
            date: startsAt,
lines: rows.map((l) => ({
                accountCode: l.accountCode,
                debit: l.debit,
                credit: l.credit,
              })),
          });
        }
      }

      await tx.auditLog.create({
        data: {
          actorId: actor?.userId ?? null,
          action: "accounting.fiscal_year.create",
          entity: "FiscalYear",
          entityId: year.id,
          newValues: { title, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() } as object,
        },
      });

      return year;
    });

    return {
      id: created.id,
      title: created.title,
      startsAt: created.startsAt.toISOString(),
      endsAt: created.endsAt.toISOString(),
      state: created.state,
    };
  }

  /**
   * بستن سال مالی + زدن سند اختتامیه و تکمیلی.
   *
   * سند اختتامیه: درآمد و هزینهٔ دوره را به حساب سود و زیان انتقال می‌دهد
   * تا ترازنامه فقط دارایی/بدهی/سرمایه نشان دهد.
   * سند تکمیلی: ماندهٔ حساب‌های موقت را به سال بعد می‌برد.
   *
   * هر دو فقط برای حساب‌هایی ساخته می‌شوند که **مانده دارند**؛
   * حساب با ماندهٔ صفر نیازی به سند ندارد و ساختنش فقط سند بی‌معنا تولید می‌کند.
   */
  @Post(":id/close")
  @RequirePermission("accounting.journal")
  async close(@Param("id") id: string, @Identity() actor?: { userId: string }) {
    const year = await this.prisma.fiscalYear.findUnique({ where: { id } });
    if (!year) throw new BadRequestException({ code: "NOT_FOUND", message: "سال مالی یافت نشد." });
    if (year.state !== "OPEN") {
      throw new BadRequestException({
        code: "FISCAL_YEAR_NOT_OPEN",
        message: `این سال در وضعیت ${year.state} است و باز نیست.`,
      });
    }

    // ماندهٔ حساب‌ها در پایان سال — از دفتر کل، نه از جدول دیگر
    const lines = await this.prisma.journalLine.groupBy({
      by: ["accountId"],
      where: { entry: { fiscalYearId: id, state: "FINAL" } },
      _sum: { debit: true, credit: true },
    });
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: lines.map((l) => l.accountId) } },
      select: { id: true, code: true, name: true, type: true, isActive: true },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));

    // حساب‌های موقت = درآمد و هزینه. ترازنامه باید فقط دارایی/بدهی/سرمایه نشان دهد.
    // فهرست از منبع واحد می‌آید، ولی روی **گروه‌های سطح ۱** فیلتر می‌شود:
    // سند اختتامیه روی گروه بسته می‌شود، نه روی تک‌تک زیرحساب‌ها — وگرنه
    // زیرحساب و والد دوبار بسته می‌شدند و سند نامتوازن می‌شد.
    const temporary = ["REVENUE", "COGS", "EXPENSE"];
    const groupCodes = new Set(temporaryGroupCodes());
    const balanceByAccount = lines
      .map((l) => {
        const a = byId.get(l.accountId);
        if (!a) return null;
        const dr = Number(l._sum.debit ?? 0);
        const cr = Number(l._sum.credit ?? 0);
        return { account: a, debit: dr, credit: cr, net: dr - cr };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const temporaryRows = balanceByAccount.filter(
      (r) => temporary.includes(r.account.type) && groupCodes.has(r.account.code),
    );

    // سند اختتامیه:Dr درآمد و هزینه / Cr سود و زیان دوره
    //   برای حساب درآمدی (Cr بیشتر): بستن آن = Dr درآمد
    //   برای حساب هزینه‌ای (Dr بیشتر): بستن آن = Cr هزینه
    const closingLines: Array<{ accountCode: string; debit: number; credit: number }> = [];
    for (const r of temporaryRows) {
      if (r.net === 0) continue;
      if (r.net > 0) closingLines.push({ accountCode: r.account.code, debit: r.net, credit: 0 });
      else closingLines.push({ accountCode: r.account.code, debit: 0, credit: -r.net });
    }

    let closingEntryId: string | null = null;
    const result = await this.prisma.$transaction(async (tx) => {

      if (closingLines.length >= 1) {
        // سود و زیان انباشته/دوره به یک حساب سرمایه‌ای بسته می‌شود (ترازنامه
        // نباید حساب درآمد یا هزینه داشته باشد). اولویت با حساب سود و زیان است.
        const retained = await tx.account.findFirst({
          where: { code: GL_EQUITY.RETAINED_EARNINGS },
        });
        const target = retained?.code ?? GL_EQUITY.CAPITAL;
        const entries: Array<{ accountCode: string; debit: number; credit: number }> = closingLines;
          const total = entries.reduce((s, l) => s + l.debit - l.credit, 0);
          // شرط «یک حساب موقت کافی است» — خط متعادل‌کننده را خودمان اضافه
          // می‌کنیم. شرط `>= 2` غلط بود و در حالت معمولِ «فقط یک حساب
          // درآمدی» هیچ سند اختتامیه‌ای ساخته نمی‌شد.
          if (entries.length >= 1 && total !== 0) {
            const linesForTx = [
              ...entries,
              total > 0
                ? { accountCode: target, debit: 0, credit: total }
                : { accountCode: target, debit: -total, credit: 0 },
            ];
            const posted = await this.journal.postInTx(tx, {
              description: `سند اختتامیه سال ${year.title}`,
              sourceType: "closing",
              date: year.endsAt,
              lines: linesForTx.map((l) => ({
                accountCode: l.accountCode,
                debit: l.debit,
                credit: l.credit,
              })),
            });
            closingEntryId = posted.id;
          }
      }

      const updated = await tx.fiscalYear.update({
        where: { id },
        data: {
          state: "CLOSED",
          closedAt: new Date(),
          closedById: actor?.userId ?? null,
          closingSnapshot: balanceByAccount.map((r) => ({
            code: r.account.code,
            name: r.account.name,
            debit: r.debit,
            credit: r.credit,
          })) as object,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: actor?.userId ?? null,
          action: "accounting.fiscal_year.close",
          entity: "FiscalYear",
          entityId: id,
          newValues: { closingEntryId, temporaryAccounts: temporaryRows.length } as object,
        },
      });

      return updated;
    });

    return {
      id: result.id,
      state: result.state,
      closedAt: result.closedAt?.toISOString() ?? null,
      closingEntryPosted: closingEntryId !== null,
    };
  }

  /**
   * باز کردن مجدد سال بسته.
   *
   * فقط برای اصلاح اشتباه. سند اختتامیهٔ قبلی **حذف نمی‌شود** — حذف سند
   * قطعی تاریخچهٔ دفاتر را بازنویسی می‌کند؛ به‌جایش کاربر بعد از بازکردن
   * سال می‌تواند سند اختتامیه را با همان سازوکار «برگشت به پیش‌نویس» اصلاح کند.
   */
  @Post(":id/reopen")
  @RequirePermission("accounting.journal")
  async reopen(@Param("id") id: string, @Identity() actor?: { userId: string }) {
    const year = await this.prisma.fiscalYear.findUnique({ where: { id } });
    if (!year) throw new BadRequestException({ code: "NOT_FOUND", message: "سال مالی یافت نشد." });
    if (year.state === "OPEN") {
      throw new BadRequestException({ code: "FISCAL_YEAR_ALREADY_OPEN", message: "این سال همین حالا باز است." });
    }

    const alreadyOpen = await this.svc.openYear();
    if (alreadyOpen && alreadyOpen.id !== id) {
      throw new BadRequestException({
        code: "FISCAL_YEAR_ALREADY_OPEN",
        message: `سال «${alreadyOpen.title}» باز است. اول آن را ببندید.`,
      });
    }

    const updated = await this.prisma.fiscalYear.update({
      where: { id },
      data: { state: "OPEN", reopenedAt: new Date(), reopenedById: actor?.userId ?? null },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: actor?.userId ?? null,
        action: "accounting.fiscal_year.reopen",
        entity: "FiscalYear",
        entityId: id,
        oldValues: { state: year.state } as object,
        newValues: { state: "OPEN" } as object,
      },
    });

    return { id: updated.id, state: updated.state };
  }
}

/** جمع ماه بدون به‌هم‌ریختگی آخرین روز ماه (۳۱ ژانویه + ۱ ماه = ۲۸/۲۹ فوریه) */
function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0);
  return d;
}