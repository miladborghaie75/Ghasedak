import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { InventoryService } from "../inventory/inventory.service";
import { JournalService } from "../accounting/journal.service";
import { PricingService } from "../pricing/pricing.service";
import { TreasuryService } from "../treasury/treasury.service";
import { ChecksService } from "../checks/checks.service";
import { nextNumber } from "../common/number-series";

export interface PosSaleLine {
  sku: string;
  qty: number;
  unitPrice?: number; // فقط با Permission pos.price_override — در فاز بعد
}

export interface PosSaleInput {
  shiftId: string;
  lines: PosSaleLine[];
  payments: Array<{
    methodCode: string;
    amount: number;
    /** فقط CHECK — فاز ۹ */
    checkNumber?: string;
    bankName?: string;
    dueDateDays?: number;
  }>;
  customerMobile?: string | null;
  customerName?: string | null;
  discountTotal?: number;
  idempotencyKey?: string;
}

const POS_TENDER_MAP: Record<string, string> = {
  cash: "CASH",
  pos_terminal: "CARD",
  card: "CARD",
  card_to_card: "BANK_TRANSFER",
  bank_transfer: "BANK_TRANSFER",
  online: "ONLINE",
  check: "CHECK",
  credit: "CREDIT",
  wallet: "WALLET",
};

/** نگاشت کد روش پرداخت عمومی → enum شِما — tender ناشناخته هرگز silent به WALLET نمی‌رود (فاز ۹) */
function toPosMethod(code: string): string {
  const m = POS_TENDER_MAP[(code || "").toLowerCase()];
  if (!m) {
    throw new BadRequestException({ code: "UNKNOWN_TENDER", message: `روش پرداخت «${code}» شناخته شده نیست.` });
  }
  return m;
}

/** POS واقعی — بند ۱۹/۲۰: همان انبار و حسابداری مرکزی؛ هیچ موجودی موازی. */
@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly journal: JournalService,
    private readonly pricing: PricingService,
    private readonly treasury: TreasuryService,
    private readonly checks: ChecksService,
  ) {}

  async openShift(input: { userId: string; registerName: string; openingCash: number }) {
    const open = await this.prisma.cashierShift.findFirst({
      where: { userId: input.userId, state: "OPEN" },
    });
    if (open) {
      throw new ConflictException({ code: "SHIFT_OPEN", message: "شیفت بازی دارید؛ اول آن را ببندید." });
    }
    let register = await this.prisma.cashRegister.findFirst({ where: { name: input.registerName } });
    if (!register) {
      register = await this.prisma.cashRegister.create({
        data: { name: input.registerName, active: true },
      });
    }
    return this.prisma.cashierShift.create({
      data: {
        registerId: register.id,
        userId: input.userId,
        openingCash: BigInt(Math.max(0, Math.round(input.openingCash))),
        state: "OPEN",
      },
    });
  }

  async closeShift(input: { shiftId: string; userId: string; actualCash: number }) {
    const shift = await this.prisma.cashierShift.findUnique({ where: { id: input.shiftId } });
    if (!shift || shift.state !== "OPEN") {
      throw new BadRequestException({ code: "SHIFT_NOT_OPEN", message: "شیفت بازی نیست." });
    }
    if (shift.userId !== input.userId) {
      throw new BadRequestException({ code: "SHIFT_OWNER", message: "این شیفت متعلق به شما نیست." });
    }
    // جمع فروش نقدی/کارت/آنلاین از منبع حقیقت: پرداخت‌های فاکتورهای شیفت
    const invoiceIds = (
      await this.prisma.posInvoice.findMany({
        where: { shiftId: shift.id },
        select: { id: true },
      })
    ).map((i) => i.id);
    const byMethod = await this.prisma.posPayment.groupBy({
      by: ["method"],
      where: { invoiceId: { in: invoiceIds } },
      _sum: { amount: true },
    });
    const sumOf = (m: string) =>
      Number(byMethod.find((b) => b.method === m)?._sum.amount ?? 0n);
    const cashSales = sumOf("CASH");
    // فاز ۸ — خزانه: هزینه‌های نقدی ثبت‌شده از دراوِر کسر می‌شوند (بند ۷۲ petty cash)
    const expected = Number(shift.openingCash) + cashSales - Number(shift.expenseTotal);
    const actual = Math.max(0, Math.round(input.actualCash));
    return this.prisma.cashierShift.update({
      where: { id: shift.id },
      data: {
        closedAt: new Date(),
        actualCash: BigInt(actual),
        expectedCash: BigInt(expected),
        difference: BigInt(actual - expected),
        cardTotal: BigInt(sumOf("CARD")),
        onlineTotal: BigInt(sumOf("ONLINE") + sumOf("BANK_TRANSFER")),
        state: "CLOSED",
      },
    });
  }

  async sale(input: PosSaleInput, cashierId: string) {
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
      throw new BadRequestException({ code: "CART_EMPTY", message: "سبد خالی است." });
    }
    for (const l of input.lines) {
      if (!Number.isSafeInteger(l.qty) || l.qty <= 0 || l.qty > 999) {
        throw new BadRequestException({ code: "VALIDATION_ERROR", message: "تعداد نامعتبر است." });
      }
    }
    const idem = input.idempotencyKey ?? `pos-auto:${randomUUID()}`;
    const existing = await this.prisma.posInvoice.findUnique({ where: { idempotencyKey: idem } });
    if (existing) {
      return { number: existing.number, grandTotal: existing.grandTotal, id: existing.id };
    }

    const merged = new Map<string, number>();
    for (const l of input.lines) merged.set(l.sku, (merged.get(l.sku) ?? 0) + l.qty);

    const shift = await this.prisma.cashierShift.findUnique({ where: { id: input.shiftId } });
    if (!shift || shift.state !== "OPEN") {
      throw new BadRequestException({ code: "SHIFT_NOT_OPEN", message: "شیفت بازی نیست." });
    }
    const channel = await this.prisma.salesChannel.findUnique({ where: { slug: "pos" } });
    if (!channel || !channel.active) {
      throw new BadRequestException({ code: "CHANNEL_INACTIVE", message: "کانال POS فعال نیست." });
    }
    const warehouseId = channel.defaultWarehouseId;

    // مشتری با موبایل — اگر جدید بود، Customer جدید تعریف می‌شود (بند ۱۹)
    let customerId: string | null = null;
    let customerName: string | null = input.customerName ?? null;
    if (input.customerMobile && /^09\d{9}$/.test(input.customerMobile)) {
      const existing = await this.prisma.customer.findUnique({ where: { mobile: input.customerMobile } });
      if (existing) {
        customerId = existing.id;
        customerName = customerName ?? existing.name;
      } else {
        const created = await this.prisma.customer.create({
          data: { mobile: input.customerMobile, name: input.customerName ?? null },
        });
        customerId = created.id;
      }
    } else if (input.customerMobile) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "موبایل باید ۱۱ رقم و با ۰۹ شروع شود." });
    }

    // قیمت POS: سطح قیمت کانال pos؛ قیمت هرگز از کلاینت‌های غیرمجاز نمی‌آید (بند ۱۲)
    const priced: Array<{ sku: string; qty: number; unit: bigint; title: string; barcode: string | null }> = [];
    let subtotal = 0n;
    for (const [sku, qty] of merged) {
      const v = await this.prisma.productVariant.findUnique({
        where: { sku },
        include: { product: { select: { name: true } } },
      });
      if (!v || v.status !== "PUBLISHED") {
        throw new NotFoundException({ code: "VARIANT_NOT_FOUND", message: `کالا «${sku}» یافت نشد.` });
      }
      // قیمت از Pricing Domain (منبع واحد) — سطح کانال pos (بند ۱۲)
      const ep = await this.pricing.effectivePrice(sku, "pos");
      const unit = BigInt(Math.round(ep.salePrice != null ? Number(ep.salePrice) : Number(ep.price)));
      subtotal += unit * BigInt(qty);
      priced.push({ sku, qty, unit, title: v.product.name, barcode: v.barcode });
    }
    const discount = BigInt(Math.max(0, Math.round(input.discountTotal ?? 0)));
    if (discount > subtotal) {
      throw new BadRequestException({ code: "DISCOUNT_INVALID", message: "تخفیف بیشتر از جمع سبد است." });
    }
    const grandTotal = subtotal - discount; // مالیات V1 = ۰ (بند ۳۰)

    const sum = input.payments.reduce((a, p) => a + Math.round(p.amount), 0);
    if (sum !== Number(grandTotal)) {
      throw new BadRequestException({
        code: "PAYMENT_MISMATCH",
        message: `مجموع پرداخت (${sum}) با مبلغ فاکتور (${Number(grandTotal)}) برابر نیست.`,
      });
    }

    // فاز ۹ (R1): CHECK = موضع چک دریافتی — بدون مشتری رد می‌شود؛ چک باید "دریافت" شود نه صرفاً پرداخت ثبت شود
    const checkPayments = input.payments.filter((p) => toPosMethod(p.methodCode) === "CHECK" && Math.round(p.amount) > 0);
    if (checkPayments.length > 0 && !customerId) {
      throw new BadRequestException({
        code: "CHECK_CUSTOMER_REQUIRED",
        message: "برای دریافت چک، مشتری (موبایل) الزامی است.",
      });
    }
    if (checkPayments.some((p) => !Number.isSafeInteger(p.dueDateDays ?? 0))) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "تاریخ چک نامعتبر است." });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const number = await nextNumber(tx, "pos_invoice", "POS", 6);
      // فاز ۸ — خزانه: مانده صندوق/بانک اتمیک با فاکتور (CASH→صندوق، CARD/ONLINE→بانک؛ CHECK اثری روی خزانه ندارد — بند ۱۰)
      await this.treasury.applyPosSaleInTx(tx, { payments: input.payments });
      const invoice = await tx.posInvoice.create({
        data: {
          number,
          channelId: channel.id,
          warehouseId,
          shiftId: shift.id,
          cashierId,
          customerId,
          customerMobile: input.customerMobile ?? null,
          customerName,
          priceLevel: 1,
          state: "FINALIZED",
          subtotal,
          discountTotal: discount,
          taxableAmount: grandTotal,
          taxTotal: 0n,
          grandTotal,
          idempotencyKey: idem,
          finalizedAt: new Date(),
          items: {
            create: priced.map((line) => ({
              variantSku: line.sku,
              qty: line.qty,
              unitPriceSnapshot: line.unit,
              lineTotal: line.unit * BigInt(line.qty),
            })),
          },
          payments: {
            create: input.payments.map((p) => ({
              method: toPosMethod(p.methodCode) as never,
              amount: BigInt(Math.round(p.amount)),
            })),
          },
        },
      });

      // فاز ۹ (R1/Wave 2 STEP 3): چک دریافتی با سرویس متمرکز دامنهٔ چک، در همان تراکنش فاکتور —
      // Check + CheckTransition(v0) + CheckCreated outbox + ردیف AR CHECK همه در یک tx؛ هیچ orphan باقی نمی‌ماند.
      const createdChecks: Array<{ checkId: string; paymentId: string }> = [];
      for (const cp of checkPayments) {
        const payment = await tx.posPayment.findFirst({
          where: { invoiceId: invoice.id, method: "CHECK", amount: BigInt(Math.round(cp.amount)), checkId: null },
          orderBy: { paidAt: "desc" },
        });
        if (!payment) {
          throw new BadRequestException({ code: "CHECK_PAYMENT_NOT_FOUND", message: "ردیف پرداخت چک یافت نشد." });
        }
        const dueDate = new Date(Date.now() + Math.max(0, Number(cp.dueDateDays ?? 0)) * 86_400_000);
        const check = await this.checks.createReceivedInTx(tx, {
          number: cp.checkNumber ?? "—",
          bankName: cp.bankName ?? "—",
          amount: BigInt(Math.round(cp.amount)),
          dueDate,
          drawer: customerName ?? null,
          customerId: customerId!,
          customerName,
          sourceType: "pos_invoice",
          sourceId: invoice.id,
          idempotencyKey: `${idem}:check:${createdChecks.length + 1}`,
          actorId: cashierId,
        });
        await tx.posPayment.update({ where: { id: payment.id }, data: { checkId: check.id } });
        createdChecks.push({ checkId: check.id, paymentId: payment.id });
      }

      // فاز ۹ (R1/Wave 2 STEP 2): سند فروش داخل تراکنش — شکست سند ⇒ rollback کامل فاکتور/چک/مانده.
      // درآمد فقط یک‌بار شناسایی می‌شود: کل فروش Cr 4000؛ Dr: نقد/بانک نقدشده + چک‌دریافتی (1220).
      // در Wave 2، بخش چکیِ Dr به‌صورت جابه‌جایی حسابداری درآمد↔AR مدل می‌شود:
      //   Dr 1220 / Cr 1210 (موضع چک) — سپس ماندهٔ نقدی: Dr 1000/1100 / Cr 1210.
      // یعنی Cr 1210 مجموع «فروش نقدی + موضع چک» = کل فروش؛ هیچ Cr 4000 دوبار رخ نمی‌دهد.
      const itemLines = priced
        .map((l) => `${l.qty}× ${l.title} [${l.sku}${l.barcode ? ` | بارکد ${l.barcode}` : ""}]`)
        .join(" ، ");
      let cashAmt = 0;
      let bankAmt = 0;
      let checkAmt = 0;
      for (const p of input.payments) {
        const m = toPosMethod(p.methodCode);
        const amt = Math.round(p.amount);
        if (m === "CASH") cashAmt += amt;
        else if (m === "CARD" || m === "ONLINE" || m === "BANK_TRANSFER") bankAmt += amt;
        else if (m === "CHECK") checkAmt += amt;
      }
      const lines: Array<{ accountCode: string; debit?: number; credit?: number }> = [];
      if (cashAmt > 0) lines.push({ accountCode: "1000", debit: cashAmt });
      if (bankAmt > 0) lines.push({ accountCode: "1100", debit: bankAmt });
      if (checkAmt > 0) lines.push({ accountCode: "1220", debit: checkAmt });
      lines.push({ accountCode: "4000", credit: Number(grandTotal) });

      // فاز ۱۴ — بند ۱: سند بهای تمام‌شدهٔ فروش در همان تراکنش (Dr 5000 / Cr 1200).
      // بهای هر قلم = میانگین انبار (wacInTx) در لحظهٔ مصرف؛ بدون بهای ثبت‌شده → سند COGS زده نمی‌شود
      // (مثلاً کالای بدون خرید ثبت‌شده) — صادقانه: سود گزارشی فقط وقتی بهای واقعی دارد محاسبه می‌شود.
      // این خط‌ها به همان سند فروش اضافه می‌شوند — یک سند، درآمد+بهایی (الگوی اسناد استاندارد).
      let cogsTotal = 0n;
      for (const line of priced) {
        const wac = await this.inventory.wacInTx(tx, warehouseId, line.sku);
        if (wac != null && wac > 0n) {
          cogsTotal += wac * BigInt(line.qty);
        }
      }
      if (cogsTotal > 0n) {
        lines.push({ accountCode: "5000", debit: Number(cogsTotal) });
        lines.push({ accountCode: "1200", credit: Number(cogsTotal) });
      }
      // تحلیل STEP 2 (درآمد فقط یک‌بار): فروش POS مستقیم = رویداد شناسایی درآمد — چکِ دریافتی خودِ دارایی است
      // (Dr 1220) و Cr 4000 دقیقاً یک‌بار زده می‌شود. جفتِ Dr 1220/Cr 1210 برای جریان دیگری است:
      // «پرداخت چک به بدهی AR-TRADE قبلی» (سفارش اعتباری → چک) که آنجا درآمد قبلاً شناسایی شده و
      // فقط exposure جابه‌جا می‌شود — در فروش مستقیم POS چنین جابه‌جایی‌ای وجود ندارد و 1210 دخالتی ندارد.
      // سطح مشتری: موضع چک در AR CHECK (exposureType=CHECK) توسط createReceivedInTx ثبت می‌شود؛
      // وصول → تسویهٔ همان ردیف (بدون double-count با TRADE).
      const entry = await this.journal.postOrNotifyInTx(tx, {
        description: `فروش POS ${number} — ${itemLines}`,
        sourceType: "pos_invoice",
        sourceId: invoice.id,
        actorId: cashierId,
        lines,
      });

      // فاز ۱۰ (بخش ۸): رویداد POS_SALE_COMPLETED — همیشه در همان tx (idempotent per invoice).
      // لایهٔ نوتیفیکیشن (event-bus) consumer آن است؛ provider پیامک هرگز اینجا hard-code نمی‌شود.
      await tx.domainEventOutbox.create({
        data: {
          name: "POS_SALE_COMPLETED",
          payload: {
            invoiceId: invoice.id,
            invoiceNumber: number,
            grandTotal: Number(grandTotal),
            customerMobile: input.customerMobile ?? null,
            customerName: customerName ?? null,
            paymentMethods: input.payments.map((p) => toPosMethod(p.methodCode)),
            createdAt: new Date().toISOString(),
            actorId: cashierId,
          } as never,
        },
      });

      // فاز ۹ (R1): رویداد دامنه در همان تراکنش (الگوی outbox in-tx موجود)
      if (createdChecks.length > 0) {
        await tx.domainEventOutbox.create({
          data: {
            name: "CheckCreated",
            payload: {
              invoiceId: invoice.id,
              invoiceNumber: number,
              customerId,
              checks: createdChecks.map((c, i) => ({
                checkId: c.checkId,
                posPaymentId: c.paymentId,
                amount: Number(checkPayments[i].amount),
                dueDateDays: Number(checkPayments[i].dueDateDays ?? 0),
              })),
              actorId: cashierId,
            } as never,
          },
        });
      }

      // فاز ۱۱ (P1-A): مصرف موجودی داخل همان تراکنش مالی — «فروش مالی ⇔ مصرف انبار» اتمیک.
      // moveInTx idempotent است (کلید pos-sale:{invoiceId}:{sku})؛ شکست انبار (موجودی ناکافی
      // و غیره) ⇒ rollback کامل فاکتور/سند/چک/خزانه/رویداد — هیچ حالت silent failure نمی‌ماند.
      for (const line of priced) {
        await this.inventory.moveInTx(tx, {
          warehouseId,
          variantSku: line.sku,
          type: "SALE",
          qty: line.qty,
          refType: "pos_invoice",
          refId: invoice.id,
          idempotencyKey: `pos-sale:${invoice.id}:${line.sku}`,
          actorId: cashierId,
        });
      }

      return { invoice, journalId: entry.id, journalNumber: entry.number };
    });

    return { number: created.invoice.number, grandTotal: created.invoice.grandTotal, id: created.invoice.id };
  }

  // ---------------- فاز ۱۰ — Invoice detail / list / correction ----------------

  /** جزئیات کامل فاکتور POS — منبع حقیقت واحد: خود فاکتور persisted (بخش ۵/۹) */
  async invoiceDetail(invoiceId: string) {
    const invoice = await this.prisma.posInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        items: { include: { variant: { select: { sku: true, product: { select: { name: true } } } } } },
        payments: { include: { check: { select: { id: true, number: true, bankName: true, dueDate: true, status: true } } } },
        cashier: { select: { id: true, name: true } },
        shift: { select: { id: true, openedAt: true, register: { select: { name: true } } } },
      },
    });
    if (!invoice) throw new NotFoundException({ code: "NOT_FOUND", message: "فاکتور یافت نشد." });
    // PosInvoice.customerId relation ندارد — lookup دستی مشتری
    const customer = invoice.customerId
      ? await this.prisma.customer.findUnique({
          where: { id: invoice.customerId },
          select: { id: true, name: true, mobile: true },
        })
      : null;
    // اثر حسابداری و انبار — از منابع حقیقت خودشان (بدون محاسبهٔ موازی)
    const [journal, ledgerMoves, corrections] = await Promise.all([
      this.prisma.journalEntry.findFirst({
        where: { sourceType: "pos_invoice", sourceId: invoice.id },
        include: { lines: { include: { account: { select: { code: true, name: true } } } } },
      }),
      this.prisma.stockLedgerEntry.findMany({ where: { refType: "pos_invoice", refId: invoice.id }, orderBy: { id: "asc" } }),
      this.prisma.posInvoice.findMany({ where: { correctsId: invoice.id }, select: { id: true, number: true, revision: true, createdAt: true } }),
    ]);
    return { invoice, customer, journal, ledgerMoves, corrections };
  }

  /** لیست فاکتورها با فیلترهای عملیاتی (بخش ۷) */
  async invoiceList(q: {
    q?: string; cashierId?: string; method?: string; state?: string;
    from?: string; to?: string; take?: number;
  }) {
    const where: Prisma.PosInvoiceWhereInput = {};
    if (q.state) where.state = q.state as never;
    if (q.cashierId) where.cashierId = q.cashierId;
    if (q.q) {
      where.OR = [
        { number: { contains: q.q } },
        { customerMobile: { contains: q.q } },
        { customerName: { contains: q.q } },
      ];
    }
    if (q.from || q.to) where.createdAt = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) };
    if (q.method) where.payments = { some: { method: q.method as never } };
    const items = await this.prisma.posInvoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(q.take ?? 50, 1), 200),
      select: {
        id: true, number: true, state: true, grandTotal: true, customerName: true,
        customerMobile: true, createdAt: true, revision: true, shiftId: true,
        cashier: { select: { name: true } },
        payments: { select: { method: true, amount: true } },
      },
    });
    return { items };
  }

  /**
   * اصلاحیهٔ کنترل‌شده (بخش ۶): FINALIZED هرگز overwrite نمی‌شود.
   * اصلاح = فاکتور جدید revision+1 با correctsId + سند حسابداری معکوس سند مبدأ + سند فروش جدید؛
   * اثر انبار فاکتور مبدأ برگردانده و اقلام اصلاحیه دوباره مصرف می‌شود. همه در یک tx + audit.
   */
  async correctInvoice(input: {
    invoiceId: string; lines: Array<{ sku: string; qty: number }>;
    payments: PosSaleInput["payments"]; discountTotal?: number;
    reason: string; idempotencyKey?: string; shiftId: string;
  }, cashierId: string) {
    if (!input.reason?.trim()) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "دلیل اصلاحیه الزامی است." });
    }
    const source = await this.prisma.posInvoice.findUnique({
      where: { id: input.invoiceId },
      include: { items: true, payments: true },
    });
    if (!source) throw new NotFoundException({ code: "NOT_FOUND", message: "فاکتور مبدأ یافت نشد." });
    if (source.state !== "FINALIZED") {
      throw new BadRequestException({ code: "NOT_FINALIZED", message: "فقط فاکتور نهایی قابل اصلاح است." });
    }
    const latest = await this.prisma.posInvoice.findFirst({
      where: { OR: [{ id: source.id }, { correctsId: source.id }] },
      orderBy: { revision: "desc" },
    });
    if (latest && latest.revision > source.revision) {
      throw new ConflictException({ code: "STALE_SOURCE", message: `این فاکتور قبلاً اصلاح شده (${latest.number}) — از آخرین نسخه اصلاح بگیرید.` });
    }
    const idem = input.idempotencyKey ?? `pos-correction:${source.id}:auto:${randomUUID()}`;
    const existing = await this.prisma.posInvoice.findUnique({ where: { idempotencyKey: idem } });
    if (existing) return { number: existing.number, grandTotal: existing.grandTotal, id: existing.id };

    // فاکتور اصلاحی با همان قواعد sale (قیمت از Pricing Domain) — ولی revision=source.revision+1
    const sale = await this.sale(
      {
        shiftId: input.shiftId,
        lines: input.lines,
        payments: input.payments,
        discountTotal: input.discountTotal,
        customerMobile: source.customerMobile,
        customerName: source.customerName,
        idempotencyKey: idem,
      },
      cashierId,
    );
    const corrected = await this.prisma.posInvoice.findUniqueOrThrow({ where: { idempotencyKey: idem } });

    // تراز کردن: سند معکوس سند مبدأ + بازگرداندن انبار مبدأ + متادیتای اصلاحیه — همه در یک tx
    const sourceEntry = await this.prisma.journalEntry.findFirst({
      where: { sourceType: "pos_invoice", sourceId: source.id },
      include: { lines: { include: { account: { select: { code: true } } } } },
    });
    await this.prisma.$transaction(async (tx) => {
      if (sourceEntry) {
        await this.journal.postOrNotifyInTx(tx, {
          description: `اصلاحیهٔ فروش POS ${source.number} → ${corrected.number} — معکوس سند ${sourceEntry.number}. دلیل: ${input.reason}`,
          sourceType: "pos_correction",
          sourceId: corrected.id,
          actorId: cashierId,
          lines: sourceEntry.lines.map((l) => ({
            accountCode: l.account.code,
            debit: Number(l.credit),
            credit: Number(l.debit),
          })),
        });
      }
      // انبار مبدأ برگردد (SALE معکوس = OPENING-مانند CORRECTION in)
      for (const item of source.items) {
        await this.inventory.moveInTx(tx, {
          warehouseId: source.warehouseId,
          variantSku: item.variantSku,
          type: "CORRECTION",
          qty: item.qty,
          refType: "pos_correction",
          refId: corrected.id,
          idempotencyKey: `pos-correction-in:${corrected.id}:${item.variantSku}`,
          actorId: cashierId,
          note: `برگشت اقلام فاکتور مبدأ ${source.number}`,
        });
      }
      await tx.posInvoice.update({
        where: { id: corrected.id },
        data: { revision: source.revision + 1, correctsId: source.id },
      });
      await tx.auditLog.create({
        data: {
          actorId: cashierId,
          action: "pos.invoice.correct",
          entity: "PosInvoice",
          entityId: source.id,
          oldValues: { number: source.number, grandTotal: source.grandTotal.toString(), revision: source.revision } as never,
          newValues: { number: corrected.number, grandTotal: corrected.grandTotal.toString(), revision: source.revision + 1, reason: input.reason } as never,
        },
      });
    });
    return { number: corrected.number, grandTotal: corrected.grandTotal, id: corrected.id, corrects: source.number };
  }

  // ---------------- فاز ۱۱ (P2-A) — تیکت ماندگار POS ----------------
  // lifecycle: OPEN → HELD → OPEN(resume) → (sale موفق) COMPLETED؛ CANCELLED terminal.
  // version = optimistic locking (بند ۱۱) — دو ترمینال همزمان هرگز ناسازگار نمی‌شوند.

  private static readonly TICKET_FLOW: Record<string, string[]> = {
    OPEN: ["HELD", "COMPLETED", "CANCELLED"],
    HELD: ["OPEN", "CANCELLED"], // resume = HELD → OPEN
    COMPLETED: [],
    CANCELLED: [],
  };

  private ticketVersionGuard(current: { version: number; status: string }, expectedVersion: number): void {
    if (current.version !== expectedVersion) {
      throw new ConflictException({
        code: "TICKET_VERSION_CONFLICT",
        message: "تیکت توسط ترمینال دیگری تغییر کرده است — دوباره بارگذاری کنید.",
      });
    }
  }

  /** ایجاد تیکت OPEN — هر terminal/cashier تیکت‌های خودش را دارد */
  async ticketCreate(input: { userId: string; shiftId?: string; items?: Array<{ sku: string; qty: number }>; customerMobile?: string; customerName?: string; discountTotal?: number }) {
    const t = await this.prisma.posTicket.create({
      data: {
        userId: input.userId,
        shiftId: input.shiftId ?? null,
        status: "OPEN",
        customerMobile: input.customerMobile ?? null,
        customerName: input.customerName ?? null,
        items: (input.items ?? []) as never,
        discountTotal: Math.max(0, Math.round(input.discountTotal ?? 0)),
        audit: [{ at: new Date().toISOString(), actorId: input.userId, action: "CREATE" }] as never,
      },
    });
    return t;
  }

  /** تیکت‌های باز/held این صندوقدار — برای بازیابی بعد از refresh/reconnect */
  async ticketList(userId: string) {
    return this.prisma.posTicket.findMany({
      where: { userId, status: { in: ["OPEN", "HELD"] } },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
  }

  async ticketGet(id: string) {
    const t = await this.prisma.posTicket.findUnique({ where: { id } });
    if (!t) throw new NotFoundException({ code: "NOT_FOUND", message: "تیکت یافت نشد." });
    return t;
  }

  /** به‌روزرسانی محتوای تیکت (items/customer/discount) — فقط در OPEN؛ با version check */
  async ticketUpdate(id: string, input: { expectedVersion: number; actorId: string; items?: Array<{ sku: string; qty: number }>; customerMobile?: string; customerName?: string; discountTotal?: number }) {
    const cur = await this.ticketGet(id);
    this.ticketVersionGuard(cur, input.expectedVersion);
    if (cur.status !== "OPEN") {
      throw new BadRequestException({ code: "TICKET_NOT_OPEN", message: "فقط تیکت OPEN قابل ویرایش است." });
    }
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.posTicket.updateMany({
        where: { id, version: input.expectedVersion, status: "OPEN" },
        data: {
          items: (input.items ?? (cur.items as unknown)) as never,
          customerMobile: input.customerMobile ?? cur.customerMobile,
          customerName: input.customerName ?? cur.customerName,
          discountTotal: input.discountTotal != null ? Math.max(0, Math.round(input.discountTotal)) : cur.discountTotal,
          version: { increment: 1 },
          audit: ([...(Array.isArray(cur.audit) ? (cur.audit as unknown[]) : []), { at: new Date().toISOString(), actorId: input.actorId, action: "UPDATE" }]) as never,
        },
      });
      if (claimed.count !== 1) throw new ConflictException({ code: "TICKET_VERSION_CONFLICT", message: "تیکت همزمان تغییر کرده است." });
      return tx.posTicket.findUniqueOrThrow({ where: { id } });
    });
  }

  /** hold / resume / cancel — گذارهای صریح با version check و audit */
  async ticketTransition(id: string, input: { expectedVersion: number; actorId: string; to: "HELD" | "OPEN" | "CANCELLED"; shiftId?: string }) {
    const cur = await this.ticketGet(id);
    this.ticketVersionGuard(cur, input.expectedVersion);
    const allowed = (PosService.TICKET_FLOW[cur.status] ?? []).includes(input.to);
    if (!allowed) {
      throw new BadRequestException({
        code: "TICKET_INVALID_TRANSITION",
        message: `گذار ${cur.status} → ${input.to} مجاز نیست.`,
      });
    }
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.posTicket.updateMany({
        where: { id, version: input.expectedVersion, status: cur.status },
        data: {
          status: input.to,
          shiftId: input.shiftId ?? cur.shiftId,
          version: { increment: 1 },
          audit: ([...(Array.isArray(cur.audit) ? (cur.audit as unknown[]) : []), { at: new Date().toISOString(), actorId: input.actorId, action: input.to }]) as never,
        },
      });
      if (claimed.count !== 1) throw new ConflictException({ code: "TICKET_VERSION_CONFLICT", message: "تیکت همزمان تغییر کرده است." });
      return tx.posTicket.findUniqueOrThrow({ where: { id } });
    });
  }

  /** پس از ثبت فروش موفق: تیکت COMPLETED می‌شود (اتمیک با شناخت تیکت اختیاری است) */
  async ticketComplete(id: string, input: { expectedVersion: number; actorId: string; invoiceId?: string }) {
    const cur = await this.ticketGet(id);
    this.ticketVersionGuard(cur, input.expectedVersion);
    if (!(PosService.TICKET_FLOW[cur.status] ?? []).includes("COMPLETED")) {
      throw new BadRequestException({ code: "TICKET_INVALID_TRANSITION", message: `گذار ${cur.status} → COMPLETED مجاز نیست.` });
    }
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.posTicket.updateMany({
        where: { id, version: input.expectedVersion, status: cur.status },
        data: {
          status: "COMPLETED",
          version: { increment: 1 },
          audit: ([...(Array.isArray(cur.audit) ? (cur.audit as unknown[]) : []), { at: new Date().toISOString(), actorId: input.actorId, action: "COMPLETED", invoiceId: input.invoiceId ?? null }]) as never,
        },
      });
      if (claimed.count !== 1) throw new ConflictException({ code: "TICKET_VERSION_CONFLICT", message: "تیکت همزمان تغییر کرده است." });
      return tx.posTicket.findUniqueOrThrow({ where: { id } });
    });
  }
}
