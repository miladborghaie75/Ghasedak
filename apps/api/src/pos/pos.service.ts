import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { InventoryService } from "../inventory/inventory.service";
import { JournalService } from "../accounting/journal.service";
import { PricingService } from "../pricing/pricing.service";
import { TreasuryService } from "../treasury/treasury.service";
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

      // فاز ۹ (R1): ثبت چک دریافتی در همان تراکنش فاکتور — هیچ orphan Check/Payment باقی نمی‌ماند
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
        const check = await tx.check.create({
          data: {
            direction: "RECEIVED",
            status: "RECEIVED",
            number: cp.checkNumber ?? "—",
            bankName: cp.bankName ?? "—",
            amount: BigInt(Math.round(cp.amount)),
            issueDate: new Date(),
            dueDate,
            drawer: customerName ?? null,
            payee: null,
            sourceType: "pos_invoice",
            sourceId: invoice.id,
            customerId,
            idempotencyKey: `${idem}:check:${createdChecks.length + 1}`,
          },
        });
        await tx.posPayment.update({ where: { id: payment.id }, data: { checkId: check.id } });
        createdChecks.push({ checkId: check.id, paymentId: payment.id });
      }

      // فاز ۹ (R1): سند فروش داخل تراکنش (postOrNotifyInTx) — شکست سند ⇒ rollback کامل فاکتور/چک/مانده
      // Cr 4000 = کل فروش؛ Dr: CASH→1000، CARD/ONLINE/BANK_TRANSFER→1100، CHECK→1220 (بند ۸ Design Gate)
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
      const entry = await this.journal.postOrNotifyInTx(tx, {
        description: `فروش POS ${number} — ${itemLines}`,
        sourceType: "pos_invoice",
        sourceId: invoice.id,
        actorId: cashierId,
        lines,
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

      return { invoice, journalId: entry.id, journalNumber: entry.number };
    });

    // مصرف مستقیم موجودی (فروش حضوری بدون رزرو) — idempotent per invoice
    for (const line of priced) {
      await this.inventory.move({
        warehouseId,
        variantSku: line.sku,
        type: "SALE",
        qty: line.qty,
        refType: "pos_invoice",
        refId: created.invoice.id,
        idempotencyKey: `pos-sale:${created.invoice.id}:${line.sku}`,
        actorId: cashierId,
      });
    }

    return { number: created.invoice.number, grandTotal: created.invoice.grandTotal, id: created.invoice.id };
  }
}
