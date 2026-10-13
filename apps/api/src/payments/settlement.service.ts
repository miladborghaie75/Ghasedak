import { BadRequestException, forwardRef, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { JournalService } from "../accounting/journal.service";
import { GL, GL_EXPENSE } from "@ghasedak/contracts";

/**
 * چرخهٔ تسویهٔ درگاه — فاز ۲٫۵
 *
 * مسئله‌ای که حل می‌کند
 * ---------------------
 * برای درگاه نقدی (کارت‌خوان) پول همان لحظه به حساب می‌رسد، پس سند فروش
 * می‌تواند مستقیم به حساب بانک بخورد. اما برای درگاه **اعتباری**:
 *
 *   • پول ۷ تا ۴۵ روز بعد می‌رسد
 *   • بخشی از آن سهم درگاه است و هرگز به ما نمی‌رسد
 *
 * اگر کل مبلغ را در همان لحظه به بانک ببریم (کاری که سیستم الان می‌کند)،
 * دو اتفاق بد می‌افتد:
 *   ۱) موجودی بانک در دفتر **بیشتر از واقعیت** نشان داده می‌شود
 *   ۲) سود فروش **بیش از واقعیت** به نظر می‌رسد، چون کارمزد اصلاً دیده نشده
 *
 * راه‌حل استاندارد حسابداری: پول اول در حساب **طلب از درگاه (۱۲۵۰)** بنشیند
 * (هنوز مال ما نیست ولی طلب ماست)، و بعد از رسیدن گزارش تسویه:
 *
 *   پرداخت تأیید شد
 *      Dr 1100 نبود — Dr 1250 طلب از درگاه      / Cr 4000 فروش
 *   گزارش تسویه رسید
 *      Dr 1100 بانک = خالص / Cr 1250 طلب از درگاه = کل
 *      Dr 6000-03 کارمزد / Cr 1250 طلب از درگاه = کارمزد
 *
 * جمع ترازنامه در هر دو لحظه ثابت است و سود خالص واقعی دیده می‌شود.
 */
@Injectable()
export class SettlementService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => JournalService)) private readonly journal: JournalService,
  ) {}

  /** بسته‌های تسویه — تازه‌ترین اول */
  async list(providerId?: string) {
    const rows = await this.prisma.settlementBatch.findMany({
      where: providerId ? { providerId } : {},
      orderBy: { settlementDate: "desc" },
      include: {
        provider: { select: { id: true, name: true, provider: true } },
        _count: { select: { attempts: true } },
      },
    });
    return rows.map((b) => ({
      id: b.id,
      providerId: b.providerId,
      providerName: b.provider.name,
      reference: b.reference,
      settlementDate: b.settlementDate.toISOString(),
      grossAmount: Number(b.grossAmount),
      feeAmount: Number(b.feeAmount),
      netAmount: Number(b.netAmount),
      status: b.status,
      attemptCount: b._count.attempts,
      journalEntryId: b.journalEntryId,
      postedAt: b.postedAt?.toISOString() ?? null,
      note: b.note,
    }));
  }

  /**
   * ثبت گزارش تسویه (قبل از زدن سند).
   *
   * تا وقتی سند زده نشده، بسته `PENDING` است و پول هنوز در حساب «طلب از درگاه»
   * می‌ماند — یعنی اگر مدیر اشتباه کند، دفتر خراب نمی‌شود.
   */
  async createBatch(input: {
    providerId: string;
    reference: string;
    settlementDate: string;
    grossAmount: number;
    feeAmount?: number;
    note?: string;
    attemptIds?: string[];
  }) {
    const provider = await this.prisma.paymentProvider.findUnique({ where: { id: input.providerId } });
    if (!provider) throw new NotFoundException({ code: "NOT_FOUND", message: "درگاه یافت نشد." });

    const reference = String(input.reference ?? "").trim();
    if (!reference) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "شمارهٔ گزارش درگاه الزامی است." });
    }

    const dup = await this.prisma.settlementBatch.findFirst({
      where: { providerId: input.providerId, reference },
    });
    if (dup) {
      throw new BadRequestException({
        code: "DUPLICATE_SETTLEMENT",
        message: `گزارش «${reference}» قبلاً ثبت شده است. دو بار وارد کردنش یعنی دوبار وارد کردن پول.`,
      });
    }

    const gross = Math.round(Number(input.grossAmount ?? 0));
    if (gross <= 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "مبلغ کل تسویه باید بیشتر از صفر باشد." });
    }

    // کارمزد از روی درصد درگاه، اگر مبلغش داده نشده باشد
    const fee =
      input.feeAmount !== undefined
        ? Math.round(Number(input.feeAmount))
        : Math.floor((gross * Number(provider.feePercentBps ?? 0)) / 10_000);

    if (fee < 0 || fee > gross) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "کارمزد نمی‌تواند منفی یا بیشتر از کل مبلغ باشد.",
      });
    }

    const settlementDate = new Date(input.settlementDate);
    if (Number.isNaN(settlementDate.getTime())) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "تاریخ تسویه نامعتبر است." });
    }

    const batch = await this.prisma.settlementBatch.create({
      data: {
        // `id` را خودمان می‌سازیم: ستون id در این دیتابیس default ندارد
        // (برخلاف جدول‌هایی که Prisma خودشان را می‌سازند).
        id: randomUUID(),
        providerId: input.providerId,
        reference,
        settlementDate,
        grossAmount: BigInt(gross),
        feeAmount: BigInt(fee),
        netAmount: BigInt(gross - fee),
        note: input.note ?? null,
        status: "PENDING",
      },
    });

    // پیوند خودکار پرداخت‌ها به بسته
    if (input.attemptIds?.length) {
      await this.prisma.paymentAttempt.updateMany({
        where: { id: { in: input.attemptIds }, state: "PAID" },
        data: { settlementBatchId: batch.id },
      });
    }

    return { id: batch.id, gross, fee, net: gross - fee, status: batch.status };
  }

  /**
   * زدن سند تسویه — تنها نقطه‌ای که پول از حساب «طلب» به بانک واقعی می‌رود.
   *
   *   Dr 1100 بانک                = خالص رسیده
   *   Dr 6000-03 کارمزد درگاه      = کارمزد (اگر از جیب فروشگاه باشد)
   *      Cr 1250 طلب از درگاه     = کل
   *
   * اگر کارمزد از جیب **خریدار** باشد، آن را از فروش کم کرده‌ایم و پولی که به
   * درگاه داده شده خالص است؛ پس سود کارمزد اضافه نمی‌کنیم وگرنه هزینهٔ
   * تکراری ثبت می‌شد.
   */
  async postBatch(batchId: string, actorId?: string) {
    const batch = await this.prisma.settlementBatch.findUnique({
      where: { id: batchId },
      include: { provider: true },
    });
    if (!batch) throw new NotFoundException({ code: "NOT_FOUND", message: "بستهٔ تسویه یافت نشد." });
    if (batch.status === "POSTED") {
      throw new BadRequestException({
        code: "ALREADY_POSTED",
        message: "برای این بسته قبلاً سند حسابداری زده شده است.",
      });
    }

    const gateway = await this.prisma.account.findUnique({ where: { code: GL.GATEWAY_RECEIVABLE } });
    if (!gateway) {
      throw new BadRequestException({
        code: "GL_MISSING",
        message: `حساب ${GL.GATEWAY_RECEIVABLE} (طلب از درگاه) تعریف نشده است.`,
      });
    }

    const gross = Number(batch.grossAmount);
    const fee = Number(batch.feeAmount);
    const net = Number(batch.netAmount);
    if (gross <= 0 || net < 0) {
      throw new BadRequestException({ code: "INVALID_BATCH", message: "مبالغ بسته معتبر نیست." });
    }

    const feeIsMerchantCost = batch.provider.feeBorneBy === "MERCHANT";

    const lines: Array<{ accountCode: string; debit?: number; credit?: number }> = [
      { accountCode: GL.BANK, debit: net },
    ];
    if (fee > 0 && feeIsMerchantCost) {
      lines.push({ accountCode: GL_EXPENSE.GATEWAY_FEE, debit: fee });
    }
    lines.push({ accountCode: GL.GATEWAY_RECEIVABLE, credit: gross });

    const entry = await this.journal.post({
      description: `تسویه درگاه ${batch.provider.name} — گزارش ${batch.reference}`,
      sourceType: "gateway_settlement",
      sourceId: batch.id,
      actorId,
      lines,
    });

    const updated = await this.prisma.settlementBatch.update({
      where: { id: batchId },
      data: {
        status: "POSTED",
        journalEntryId: entry.id,
        postedAt: new Date(),
        postedById: actorId ?? null,
      },
    });

    return { ok: true, journalNumber: entry.number, status: updated.status };
  }

  /** باطل‌کردن یک بستهٔ اشتباهِ واردشده (قبل از سند) */
  async voidBatch(batchId: string, reason?: string) {
    const batch = await this.prisma.settlementBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException({ code: "NOT_FOUND", message: "بستهٔ تسویه یافت نشد." });
    if (batch.status === "POSTED") {
      throw new BadRequestException({
        code: "ALREADY_POSTED",
        message: "این بسته سند حسابداری دارد؛ اول سند را به پیش‌نویس برگردانید.",
      });
    }
    await this.prisma.settlementBatch.update({
      where: { id: batchId },
      data: { status: "VOID", note: reason ?? batch.note },
    });
    await this.prisma.paymentAttempt.updateMany({
      where: { settlementBatchId: batchId },
      data: { settlementBatchId: null },
    });
    return { ok: true, status: "VOID" };
  }

  /**
   * پرداخت‌های تسویه‌نشده — گزارش «پولی که هنوز نرسیده».
   *
   * سن مهم است: پرداختی که بیش از `settlementDays` درگاه از روزش گذشته و هنوز
   * در هیچ بسته‌ای نیست، یعنی گزارش تسویه‌اش را از دست داده‌ایم و باید پیگیری شود.
   */
  async unsettled(providerId?: string) {
    const rows = await this.prisma.paymentAttempt.findMany({
      where: {
        state: "PAID",
        settlementBatchId: null,
        ...(providerId ? { providerId } : {}),
        ...(providerId ? {} : { providerId: { not: null } }),
      },
      orderBy: { verifiedAt: "desc" },
      take: 200,
      include: {
        provider: { select: { id: true, name: true, settlementDays: true } },
        order: { select: { code: true } },
      },
    });

    const today = Date.now();
    return rows.map((r) => {
      const days = r.provider?.settlementDays ?? 1;
      const ageDays = r.verifiedAt
        ? Math.floor((today - new Date(r.verifiedAt).getTime()) / 86_400_000)
        : 0;
      return {
        attemptId: r.id,
        orderCode: r.order?.code ?? null,
        amount: Number(r.amount),
        providerId: r.providerId,
        providerName: r.provider?.name ?? null,
        verifiedAt: r.verifiedAt?.toISOString() ?? null,
        ageDays,
        expectedByDays: days,
        overdue: ageDays > days,
      };
    });
  }

  /** خلاصهٔ وضعیت تسویه برای داشبورد */
  async summary() {
    const [batches, pending] = await Promise.all([this.list(), this.unsettled()]);
    const posted = batches.filter((b) => b.status === "POSTED");
    return {
      batchCount: batches.length,
      postedCount: posted.length,
      pendingCount: batches.filter((b) => b.status === "PENDING").length,
      unsettledCount: pending.length,
      /** پولی که نزد درگاه است و هنوز به حساب ما نیامده */
      unsettledAmount: pending.reduce((s, p) => s + p.amount, 0),
      /** پولی که از حساب‌مان خارج شده (کارمزد) */
      totalFees: posted.reduce((s, b) => s + b.feeAmount, 0),
      overdueCount: pending.filter((p) => p.overdue).length,
    };
  }
}
