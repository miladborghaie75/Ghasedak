import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { InventoryService, warehouseGlCode } from "../inventory/inventory.service";
import { JournalService } from "./journal.service";
import { GL_COGS } from "@ghasedak/contracts";
import { backgroundWorkersEnabled } from "../common/background-workers";

/**
 * فاز ۱۴ بند ۱ — بازپرکردن «بهای تمام‌شدهٔ عقب‌افتاده» (F0-2).
 *
 * مسئله: سند فروش در لحظهٔ پرداخت وقتی زده می‌شود که ممکن است بهای
 * میانگین (WAC) آن SKU هنوز معلوم نباشد (مثلاً موجودی با OPENING/خریدِ
 * بی‌بها وارد شده یا CostLayer خالی است). در آن حالت سند فروش صادقانه
 * بدون سطر 5000 ثبت می‌شود — یعنی دفتر کل COGS را صفر می‌شود ولی جدول
 * سود (که WAC لحظهٔ گزارش را می‌خواند) عدد دارد؛ دو منبع، دو عدد.
 *
 * راه‌حل: وقتی بها معلوم شد، یک سند مکمل Dr 5000 / Cr موجودی ثبت می‌شود
 * که همان سفارش را به سطر COGS می‌رساند. KPI و جدول یکی می‌شوند.
 *
 * Idempotency (بند ۱۱۶):
 *  - اگر سند فروش سفارش از قبل سطر 5000 دارد → کاری لازم نیست.
 *  - اگر سند مکمل قبلاً ثبت شده → دوباره ثبت نمی‌شود (منبع: sourceType
 *    `order-cogs-backfill` + sourceId سفارش).
 *  - ترتیب جست‌وجوی «سند مکمل» قبل از محاسبهٔ WAC است تا حتی با تغییر
 *    بهای انبار، سند تاریخی دست‌نخورده بماند.
 *
 * اجرا: (۱) اکشن ادمین «ثبت COGS عقب‌افتاده» (گزارش‌های مدیریتی)،
 *        (۲) worker دوره‌ای همین سرویس (با GHASEDAK_WORKERS=off خاموش).
 */
export interface CogsBackfillResult {
  orderId: string;
  code: string | null;
  posted: boolean;
  reason?:
    | "NOT_FOUND"
    | "NOT_PAID"
    | "NO_WAREHOUSE"
    | "ALREADY_HAS_COGS"
    | "ALREADY_BACKFILLED"
    | "NO_COST"
    | "JOURNAL_FAILED";
  amount?: string;
  entryId?: string;
  entryNumber?: string;
  missingSkus?: string[];
  error?: string;
}

@Injectable()
export class CogsBackfillService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CogsBackfillService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly journal: JournalService,
  ) {}

  onModuleInit(): void {
    // هر ۱۰ دقیقه سفارش‌های تازهٔ PAID را اسکن می‌کند؛ اگر بهایشان تا الان
    // معلوم شده باشد سند مکمل ثبت می‌شود. سفارش‌های بی‌بها صادقانه رد
    // می‌شوند و در گزارش worker دیده می‌شوند (نه سند ساختگی).
    if (!backgroundWorkersEnabled()) {
      this.logger.log("Background workers disabled (GHASEDAK_WORKERS=off) — CogsBackfill timer not started");
      return;
    }
    this.timer = setInterval(
      () => void this.scanRecent().catch((e) => this.logger.warn(`cogs backfill failed: ${e instanceof Error ? e.message : e}`)),
      10 * 60_000,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** یک سفارش مشخص — قلب اکشن ادمین و تست رگرسیون */
  async backfillOrder(orderId: string, actorId?: string): Promise<CogsBackfillResult> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        code: true,
        warehouseId: true,
        paymentStatus: true,
        items: { select: { qty: true, variant: { select: { sku: true } } } },
      },
    });
    if (!order) return { orderId, code: null, posted: false, reason: "NOT_FOUND" };
    if (order.paymentStatus !== "PAID") {
      return { orderId: order.id, code: order.code, posted: false, reason: "NOT_PAID" };
    }
    if (!order.warehouseId) {
      return { orderId: order.id, code: order.code, posted: false, reason: "NO_WAREHOUSE" };
    }

    // ۱) اگر سند فروش همین سفارش سطر 5000 دارد، چیزی کم نیست
    const cogsAccount = await this.prisma.account.findUnique({
      where: { code: GL_COGS.COGS },
      select: { id: true },
    });
    if (cogsAccount) {
      const has = await this.prisma.journalLine.findFirst({
        where: {
          accountId: cogsAccount.id,
          debit: { gt: 0 },
          entry: { sourceType: "order", sourceId: order.id },
        },
        select: { id: true },
      });
      if (has) return { orderId: order.id, code: order.code, posted: false, reason: "ALREADY_HAS_COGS" };
    }

    // ۲) سند مکمل قبلاً ثبت شده؟ (idempotent — قبل از محاسبهٔ WAC)
    const prior = await this.prisma.journalEntry.findFirst({
      where: { sourceType: "order-cogs-backfill", sourceId: order.id },
      select: { id: true, number: true },
    });
    if (prior) {
      return {
        orderId: order.id,
        code: order.code,
        posted: false,
        reason: "ALREADY_BACKFILLED",
        entryId: prior.id,
        entryNumber: prior.number,
      };
    }

    // ۳) بهای میانگین هر SKU در انبار همین سفارش — فقط قیمت‌های معلوم
    let total = 0n;
    const missingSkus: string[] = [];
    for (const it of order.items) {
      const sku = it.variant?.sku;
      if (!sku) continue;
      const wac = await this.inventory.wac(order.warehouseId, sku);
      if (wac != null && wac > 0n) total += wac * BigInt(it.qty);
      else missingSkus.push(sku);
    }
    if (total === 0n) {
      return { orderId: order.id, code: order.code, posted: false, reason: "NO_COST", missingSkus };
    }

    // ۴) سند مکمل: Dr 5000 / Cr موجودیِ همان انبار
    const invCode = await warehouseGlCode(this.prisma, order.warehouseId);
    const res = await this.journal.postOrNotify({
      description: `ثبت بهای تمام‌شدهٔ عقب‌افتاده — سفارش ${order.code}`,
      sourceType: "order-cogs-backfill",
      sourceId: order.id,
      warehouseId: order.warehouseId,
      actorId,
      lines: [
        { accountCode: GL_COGS.COGS, debit: Number(total) },
        { accountCode: invCode, credit: Number(total) },
      ],
    });
    if (!res.posted) {
      return { orderId: order.id, code: order.code, posted: false, reason: "JOURNAL_FAILED", error: res.error?.message, missingSkus };
    }

    await this.prisma.auditLog
      .create({
        data: {
          actorId: actorId ?? null,
          action: "accounting.cogs.backfill",
          entity: "Order",
          entityId: order.id,
          newValues: {
            code: order.code,
            amount: total.toString(),
            entryId: res.id,
            entryNumber: res.number,
            missingSkus,
          },
        },
      })
      .catch(() => undefined); // ثبت شکستِ audit نباید سند را بی‌اثر کند

    return {
      orderId: order.id,
      code: order.code,
      posted: true,
      amount: total.toString(),
      entryId: res.id,
      entryNumber: res.number,
      missingSkus,
    };
  }

  /**
   * اسکن دسته‌ای — سفارش‌های PAID اخیر (پیش‌فرض ۵۰).
   * نتیجه: تعداد/مبلغ سندهای ثبت‌شده + سفارش‌های بی‌بها برای پیگیری.
   */
  async scan(actorId?: string, limit = 50): Promise<{
    scanned: number;
    postedCount: number;
    postedAmount: string;
    alreadyOk: number;
    noCostCount: number;
    results: CogsBackfillResult[];
  }> {
    const take = Math.min(Math.max(1, Math.floor(limit) || 50), 200);
    const orders = await this.prisma.order.findMany({
      where: { paymentStatus: "PAID" },
      orderBy: { createdAt: "desc" },
      take,
      select: { id: true },
    });
    const results: CogsBackfillResult[] = [];
    for (const o of orders) results.push(await this.backfillOrder(o.id, actorId));
    const posted = results.filter((r) => r.posted);
    return {
      scanned: orders.length,
      postedCount: posted.length,
      postedAmount: posted.reduce((s, r) => s + BigInt(r.amount ?? "0"), 0n).toString(),
      alreadyOk: results.filter((r) => r.reason === "ALREADY_HAS_COGS").length,
      noCostCount: results.filter((r) => r.reason === "NO_COST").length,
      // فقط موارد行动‌پذیر برگردانده می‌شوند تا پاسخ ادمین قابل خواندن بماند
      results: results.filter((r) => r.posted || r.reason === "NO_COST" || r.reason === "ALREADY_BACKFILLED"),
    };
  }

  /** اجرای دوره‌ای — فقط لاگ خلاصه؛ شکست‌ها بی‌صدا نمی‌مانند */
  private async scanRecent(): Promise<void> {
    try {
      const r = await this.scan(undefined, 20);
      if (r.postedCount > 0) {
        this.logger.log(`COGS backfill worker: ${r.postedCount} سند مکمل به مبلغ ${r.postedAmount} (از ${r.scanned} سفارش)`);
      }
      if (r.noCostCount > 0) {
        this.logger.warn(`COGS backfill worker: ${r.noCostCount} سفارش هنوز بهای ثبت‌شده ندارد — بهای خرید را کامل کنید`);
      }
    } catch (e) {
      this.logger.error(`COGS backfill worker failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
