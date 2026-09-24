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
import { nextNumber } from "../common/number-series";

export interface PosSaleLine {
  sku: string;
  qty: number;
  unitPrice?: number; // فقط با Permission pos.price_override — در فاز بعد
}

export interface PosSaleInput {
  shiftId: string;
  lines: PosSaleLine[];
  payments: Array<{ methodCode: string; amount: number }>;
  customerMobile?: string | null;
  customerName?: string | null;
  discountTotal?: number;
  idempotencyKey?: string;
}

/** نگاشت کد روش پرداخت عمومی → enum شِما */
function toPosMethod(code: string): string {
  switch (code) {
    case "cash": return "CASH";
    case "pos_terminal": case "card": return "CARD";
    case "card_to_card": case "bank_transfer": return "BANK_TRANSFER";
    case "online": return "ONLINE";
    case "check": return "CHECK";
    default: return "WALLET";
  }
}

/** POS واقعی — بند ۱۹/۲۰: همان انبار و حسابداری مرکزی؛ هیچ موجودی موازی. */
@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly journal: JournalService,
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
    const expected = Number(shift.openingCash) + cashSales;
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
      const vp = await this.prisma.variantPrice.findUnique({
        where: { variantSku_priceLevelId: { variantSku: sku, priceLevelId: channel.priceLevelId } },
      });
      const unit = BigInt(Math.round(vp?.price != null ? Number(vp.price) : Number(v.price)));
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

    const created = await this.prisma.$transaction(async (tx) => {
      const number = await nextNumber(tx, "pos_invoice", "POS", 6);
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
      return invoice;
    });

    // مصرف مستقیم موجودی (فروش حضوری بدون رزرو) — idempotent per invoice
    for (const line of priced) {
      await this.inventory.move({
        warehouseId,
        variantSku: line.sku,
        type: "SALE",
        qty: line.qty,
        refType: "pos_invoice",
        refId: created.id,
        idempotencyKey: `pos-sale:${created.id}:${line.sku}`,
        actorId: cashierId,
      });
    }

    // سند حسابداری: Dr صندوق/بانک، Cr فروش (COGS/WAC در فاز O)
    // ردیف کالا با SKU/بارکد در توضیح — ردیابی بارکد در حسابداری (درخواست کاربر)
    const itemLines = priced
      .map((l) => `${l.qty}× ${l.title} [${l.sku}${l.barcode ? ` | بارکد ${l.barcode}` : ""}]`)
      .join(" ، ");
    await this.journal.post({
      description: `فروش POS ${created.number} — ${itemLines}`,
      sourceType: "pos_invoice",
      sourceId: created.id,
      actorId: cashierId,
      lines: [
        { accountCode: "1100", debit: Number(grandTotal) },
        { accountCode: "4000", credit: Number(grandTotal) },
      ],
    });

    return { number: created.number, grandTotal: created.grandTotal, id: created.id };
  }
}
