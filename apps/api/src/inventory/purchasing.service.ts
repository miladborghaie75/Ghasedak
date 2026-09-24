import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { InventoryService } from "./inventory.service";
import { nextNumber } from "../common/number-series";
import { EventBusService } from "../events/event-bus.service";

/**
 * چرخه خرید — بند ۲۷–۲۹/۴۳: PO → GRN (ورود بهایی به انبار + WAC) → Invoice → AP.
 * Ledger منبع حقیقت؛ همه حرکت‌ها idempotent؛ اسناد نهایی immutable.
 */

function qtyPositive(n: unknown, label: string): number {
  const v = Number(n);
  if (!Number.isSafeInteger(v) || v <= 0) {
    throw new BadRequestException({ code: "VALIDATION_ERROR", message: `تعداد «${label}» باید عدد صحیح مثبت باشد.` });
  }
  return v;
}

function costNonNegative(n: unknown): bigint {
  const v = BigInt(Math.round(Number(n ?? 0)));
  if (v < 0n) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "بها نمی‌تواند منفی باشد." });
  return v;
}

@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inv: InventoryService,
    private readonly events: EventBusService,
  ) {}

  // ---------------- تامین‌کننده ----------------

  async listSuppliers() {
    return this.prisma.$transaction(async (tx) => {
      const suppliers = await tx.supplier.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
      });
      const accounts = await tx.supplierAccount.findMany({
        where: { supplierId: { in: suppliers.map((s) => s.id) } },
      });
      const byId = new Map(accounts.map((a) => [a.supplierId, a]));
      return { items: suppliers.map((s) => ({ ...s, account: byId.get(s.id) ?? null })) };
    });
  }

  async createSupplier(input: { name: string; phone?: string; address?: string; taxId?: string; creditLimit?: number; notes?: string; actorId?: string }) {
    if (!input.name?.trim()) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "نام تامین‌کننده الزامی است." });
    const s = await this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.create({
        data: {
          name: input.name.trim(),
          phone: input.phone,
          address: input.address,
          taxId: input.taxId,
          creditLimit: input.creditLimit != null ? BigInt(input.creditLimit) : null,
          notes: input.notes,
        },
      });
      await tx.supplierAccount.create({ data: { supplierId: supplier.id } });
      return supplier;
    });
    await this.audit(input.actorId, "purchasing.supplier.create", "Supplier", s.id, { name: s.name });
    return s;
  }

  async updateSupplier(id: string, input: { name?: string; phone?: string; address?: string; taxId?: string; creditLimit?: number | null; notes?: string; actorId?: string }) {
    const s = await this.prisma.supplier.findUnique({ where: { id } });
    if (!s || s.deletedAt) throw new NotFoundException({ code: "NOT_FOUND", message: "تامین‌کننده یافت نشد." });
    const data: Record<string, unknown> = {};
    for (const k of ["name", "phone", "address", "taxId", "notes"] as const) if (input[k] !== undefined) data[k] = input[k];
    if (input.creditLimit !== undefined) data.creditLimit = input.creditLimit != null ? BigInt(input.creditLimit) : null;
    const updated = await this.prisma.supplier.update({ where: { id }, data: data as never });
    await this.audit(input.actorId, "purchasing.supplier.update", "Supplier", id, data);
    return updated;
  }

  // ---------------- Purchase Order ----------------

  async listPOs(q: { status?: string }) {
    const items = await this.prisma.purchaseOrder.findMany({
      where: q.status ? { status: q.status as never } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { supplier: { select: { name: true } }, _count: { select: { items: true } } },
    });
    return { items };
  }

  async getPO(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        items: { include: { variant: { select: { sku: true, product: { select: { name: true } } } } } },
        receipts: { select: { id: true, number: true, receivedAt: true } },
      },
    });
    if (!po) throw new NotFoundException({ code: "NOT_FOUND", message: "سفارش خرید یافت نشد." });
    return po;
  }

  async createPO(input: { supplierId: string; lines: Array<{ variantSku: string; qty: number; unitCost: number }>; note?: string; actorId?: string }) {
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "حداقل یک ردیف لازم است." });
    }
    const supplier = await this.prisma.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier || supplier.deletedAt) throw new NotFoundException({ code: "NOT_FOUND", message: "تامین‌کننده یافت نشد." });
    const lines = input.lines.map((l) => ({ variantSku: String(l.variantSku).trim(), qty: qtyPositive(l.qty, l.variantSku), unitCost: costNonNegative(l.unitCost) }));
    const po = await this.prisma.purchaseOrder.create({
      data: {
        number: await this.prisma.$transaction((tx) => nextNumber(tx, "purchase_order", "PO", 5)),
        supplierId: supplier.id,
        note: input.note,
        items: { create: lines },
      },
      include: { items: true },
    });
    await this.audit(input.actorId, "purchasing.po.create", "PurchaseOrder", po.id, { number: po.number });
    return po;
  }

  /** DRAFT → SENT (ارسال به تامین‌کننده)؛ immutable پس از دریافت اول */
  async sendPO(id: string, actorId?: string) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id }, include: { receipts: true } });
    if (!po) throw new NotFoundException({ code: "NOT_FOUND", message: "سفارش خرید یافت نشد." });
    if (po.status !== "DRAFT") throw new BadRequestException({ code: "INVALID_STATE", message: "فقط پیش‌نویس قابل ارسال است." });
    if (po.receipts.length > 0) throw new BadRequestException({ code: "INVALID_STATE", message: "سند دریافت دارد — قابل ارسال نیست." });
    const updated = await this.prisma.purchaseOrder.update({ where: { id }, data: { status: "SENT" } });
    await this.events.publish("PurchaseOrderSent", { poId: po.id, number: po.number });
    await this.audit(actorId, "purchasing.po.send", "PurchaseOrder", id, { number: po.number });
    return updated;
  }

  async cancelPO(id: string, actorId?: string) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id }, include: { receipts: true } });
    if (!po) throw new NotFoundException({ code: "NOT_FOUND", message: "سفارش خرید یافت نشد." });
    if (po.receipts.length > 0) throw new BadRequestException({ code: "INVALID_STATE", message: "سند دریافت دارد — قابل لغو نیست." });
    const updated = await this.prisma.purchaseOrder.update({ where: { id }, data: { status: "CANCELLED" } });
    await this.audit(actorId, "purchasing.po.cancel", "PurchaseOrder", id, { number: po.number });
    return updated;
  }

  // ---------------- Goods Receipt (GRN) ----------------

  async listGRNs() {
    const items = await this.prisma.goodsReceipt.findMany({
      orderBy: { receivedAt: "desc" },
      take: 100,
      include: { supplier: { select: { name: true } }, warehouse: { select: { code: true, name: true } }, po: { select: { number: true } }, _count: { select: { items: true } } },
    });
    return { items };
  }

  /**
   * دریافت کالا — PURCHASE به انبار (idempotent با کلید grn:{number}:{sku}) + WAC update.
   * هزینه متفرقه GRN (حمل/بسته‌بندی) به‌صورت landedCost سرخط تخصیص و در WAC لحاظ می‌شود.
   */
  async createGRN(input: {
    supplierId: string; warehouseId: string; poId?: string;
    lines: Array<{ variantSku: string; qty: number; unitCost: number; landedCost?: number }>;
    note?: string; actorId?: string;
  }) {
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id: input.warehouseId } });
    if (!warehouse || !warehouse.active) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "انبار مقصد نامعتبر است." });
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "حداقل یک ردیف لازم است." });
    }
    const supplier = await this.prisma.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier) throw new NotFoundException({ code: "NOT_FOUND", message: "تامین‌کننده یافت نشد." });

    let po: { id: string; number: string; status: string; items: Array<{ variantSku: string; qty: number }> } | null = null;
    if (input.poId) {
      const found = await this.prisma.purchaseOrder.findUnique({ where: { id: input.poId }, include: { items: true } });
      if (!found) throw new NotFoundException({ code: "NOT_FOUND", message: "سفارش خرید یافت نشد." });
      if (found.status !== "SENT" && found.status !== "RECEIVED") {
        throw new BadRequestException({ code: "INVALID_STATE", message: "فقط PO ارسال‌شده قابل دریافت است." });
      }
      po = found;
    }

    const lines = input.lines.map((l) => ({
      variantSku: String(l.variantSku).trim(),
      qty: qtyPositive(l.qty, l.variantSku),
      unitCost: costNonNegative(l.unitCost),
      landedCost: costNonNegative(l.landedCost ?? 0),
    }));

    const grn = await this.prisma.$transaction(async (tx) => {
      const number = await nextNumber(tx, "goods_receipt", "GRN", 5);
      const rec = await tx.goodsReceipt.create({
        data: {
          number,
          supplierId: supplier.id,
          warehouseId: warehouse.id,
          poId: po?.id,
          note: input.note,
          items: { create: lines },
        },
        include: { items: true },
      });
      for (const line of lines) {
        // ورود بهایی به انبار
        await this.inv.moveInTx(tx, {
          warehouseId: warehouse.id,
          variantSku: line.variantSku,
          type: "PURCHASE",
          qty: line.qty,
          unitCost: line.unitCost,
          refType: "goods_receipt",
          refId: rec.id,
          idempotencyKey: `grn:${number}:${line.variantSku}`,
          actorId: input.actorId,
          note: `دریافت ${number}`,
        });
        // WAC شامل سهم landedCost سرخط
        const unitWithLanded = line.unitCost + (line.landedCost > 0n ? line.landedCost / BigInt(line.qty) : 0n);
        await this.inv.updateWacInTx(tx, warehouse.id, line.variantSku, line.qty, unitWithLanded);
      }
      if (po) await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "RECEIVED" } });
      return rec;
    });
    await this.events.publish("GoodsReceiptPosted", { grnId: grn.id, number: grn.number, supplierId: supplier.id, lines: lines.length });
    await this.audit(input.actorId, "purchasing.grn.create", "GoodsReceipt", grn.id, { number: grn.number, lines: lines.length });
    return grn;
  }

  // ---------------- Purchase Invoice + Three-Way Match + AP ----------------

  async listInvoices(q: { state?: string }) {
    const items = await this.prisma.purchaseInvoice.findMany({
      where: q.state ? { state: q.state as never } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        supplier: { select: { name: true } },
        receipt: { select: { number: true } },
        _count: { select: { payments: true } },
      },
    });
    return { items };
  }

  /**
   * ثبت فاکتور خرید — Three-Way Match: PO / GRN / Invoice (تعداد و بها سرخط).
   * خطای quantity/price variance با کد صریح؛ POSTED → AP باز می‌شود.
   */
  async createInvoice(input: {
    supplierId: string; grnId: string; number?: string;
    lines: Array<{ variantSku: string; qty: number; unitCost: number }>;
    shippingTotal?: number; taxTotal?: number; dueDate?: string; actorId?: string;
  }) {
    const grn = await this.prisma.goodsReceipt.findUnique({
      where: { id: input.grnId },
      include: { items: true, po: { include: { items: true } } },
    });
    if (!grn) throw new NotFoundException({ code: "NOT_FOUND", message: "سند دریافت یافت نشد." });

    // Three-way match: تعداد فاکتور ≠ تعداد GRN → رد؛ بهای فاکتور ≠ بهای PO → PPV صریح
    const qtyErrors: string[] = [];
    const ppvLines: Array<{ sku: string; poCost: number; invoiceCost: number }> = [];
    const grnBySku = new Map(grn.items.map((i) => [i.variantSku, i]));
    for (const line of input.lines) {
      const sku = String(line.variantSku).trim();
      const g = grnBySku.get(sku);
      if (!g) { qtyErrors.push(`${sku}: در سند دریافت نیست`); continue; }
      if (Number(line.qty) !== g.qty) qtyErrors.push(`${sku}: فاکتور ${line.qty} ≠ دریافت ${g.qty}`);
      const poItem = grn.po?.items.find((i) => i.variantSku === sku);
      if (poItem && BigInt(Math.round(Number(line.unitCost))) !== poItem.unitCost) {
        ppvLines.push({ sku, poCost: Number(poItem.unitCost), invoiceCost: Math.round(Number(line.unitCost)) });
      }
    }
    for (const [sku, g] of grnBySku) {
      if (!input.lines.some((l) => String(l.variantSku).trim() === sku)) qtyErrors.push(`${sku}: در فاکتور نیست`);
    }
    if (qtyErrors.length > 0) {
      throw new BadRequestException({ code: "THREE_WAY_MISMATCH", message: `عدم تطابق سه‌طرفه: ${qtyErrors.join(" | ")}` });
    }

    const subtotal = input.lines.reduce((acc, l) => acc + Math.round(Number(l.unitCost)) * Number(l.qty), 0);
    const shipping = Math.max(0, Math.round(Number(input.shippingTotal ?? 0)));
    const tax = Math.max(0, Math.round(Number(input.taxTotal ?? 0)));
    const grandTotal = subtotal + shipping + tax;

    const invoice = await this.prisma.$transaction(async (tx) => {
      const number = await nextNumber(tx, "purchase_invoice", "PINV", 5);
      const inv = await tx.purchaseInvoice.create({
        data: {
          number,
          supplierId: input.supplierId,
          grId: grn.id,
          state: "POSTED",
          subtotal: BigInt(subtotal),
          shippingTotal: BigInt(shipping),
          taxTotal: BigInt(tax),
          grandTotal: BigInt(grandTotal),
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          items: { create: input.lines.map((l) => ({ variantSku: String(l.variantSku).trim(), qty: Number(l.qty), unitCost: BigInt(Math.round(Number(l.unitCost))) })) },
        },
      });
      // AP — بند ۴۸: بدهی واقعی به تامین‌کننده
      const sa = await tx.supplierAccount.findUnique({ where: { supplierId: input.supplierId } });
      if (!sa) throw new NotFoundException({ code: "NOT_FOUND", message: "حساب تامین‌کننده یافت نشد." });
      await tx.accountsPayable.create({
        data: {
          accountPId: sa.id,
          refType: "purchase_invoice",
          refId: inv.id,
          amount: BigInt(grandTotal),
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
        },
      });
      await tx.supplierAccount.update({
        where: { id: sa.id },
        data: { outstanding: { increment: BigInt(grandTotal) } },
      });
      return inv;
    });
    if (ppvLines.length > 0) {
      await this.events.publish("PurchasePriceVariance", { invoiceId: invoice.id, number: invoice.number, lines: ppvLines });
    }
    await this.audit(input.actorId, "purchasing.invoice.create", "PurchaseInvoice", invoice.id, { number: invoice.number, grandTotal, ppvLines: ppvLines.length });
    return { invoice, ppvLines };
  }

  /** پرداخت فاکتور خرید — AP تسویه (کامل/جزیی) + سند حسابداری */
  async payInvoice(input: { invoiceId: string; amount: number; method?: string; actorId?: string }) {
    const amount = Math.round(Number(input.amount));
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "مبلغ پرداخت نامعتبر است." });
    }
    const invoice = await this.prisma.purchaseInvoice.findUnique({
      where: { id: input.invoiceId },
      include: { payments: true },
    });
    if (!invoice) throw new NotFoundException({ code: "NOT_FOUND", message: "فاکتور یافت نشد." });
    if (invoice.state === "PAID") throw new BadRequestException({ code: "INVALID_STATE", message: "فاکتور تسویه شده است." });
    const paid = invoice.payments.reduce((acc, p) => acc + Number(p.amount), 0) + amount;
    if (paid > Number(invoice.grandTotal)) {
      throw new BadRequestException({ code: "OVERPAY", message: `مجموع پرداخت (${paid}) از کل فاکتور (${Number(invoice.grandTotal)}) بیشتر است.` });
    }
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.purchasePayment.create({
        data: { invoiceId: invoice.id, method: input.method ?? "transfer", amount: BigInt(amount) },
      });
      const ap = await tx.accountsPayable.findFirst({
        where: { refType: "purchase_invoice", refId: invoice.id },
      });
      if (ap) {
        const paidAmount = ap.paidAmount + BigInt(amount);
        await tx.accountsPayable.update({
          where: { id: ap.id },
          data: {
            paidAmount,
            state: paidAmount >= ap.amount ? "SETTLED" : "PARTIAL",
          },
        });
      }
      await tx.supplierAccount.updateMany({
        where: { supplierId: invoice.supplierId },
        data: { outstanding: { decrement: BigInt(amount) } },
      });
      const state = paid >= Number(invoice.grandTotal) ? "PAID" : "PARTIALLY_PAID";
      await tx.purchaseInvoice.update({ where: { id: invoice.id }, data: { state } });
      return { state, paid };
    });
    await this.audit(input.actorId, "purchasing.invoice.pay", "PurchaseInvoice", invoice.id, { amount, state: result.state });
    return result;
  }

  async audit(actorId: string | undefined, action: string, entity: string, entityId: string, meta: Record<string, unknown>): Promise<void> {
    await this.prisma.auditLog.create({
      data: { actorId: actorId ?? null, action, entity, entityId, newValues: meta as object },
    }).catch(() => undefined);
  }
}
