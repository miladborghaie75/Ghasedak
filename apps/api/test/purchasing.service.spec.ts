/**
 * تست‌های چرخه خرید — بند ۲۷/۲۸ Master + بند ۴۸:
 * Three-Way Match (تعداد/بها)، PPV، AP، پرداخت، detail (snapshot/audit)، picker.
 * با DB واقعی dev اجرا می‌شود (همان الگوی inventory.core.spec).
 */
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PurchasingService } from "../src/inventory/purchasing.service";
import { InventoryService } from "../src/inventory/inventory.service";
import { InventorySettingsService } from "../src/inventory/inventory-settings.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { EventBusService } from "../src/events/event-bus.service";

describe("PurchasingService (integration با DB dev)", () => {
  let prisma: PrismaService;
  let service: PurchasingService;
  let inv: InventoryService;
  let supplierId: string;
  let warehouseId: string;
  let grnId: string;
  let poId: string | undefined;
  const createdInvoices: string[] = [];
  const testSkus: string[] = [];
  /** actorId واقعی (FK به User) — اولین کاربر DB */
  let actor: string | undefined;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    inv = new InventoryService(prisma, new InventorySettingsService(prisma));
    service = new PurchasingService(prisma, inv, new EventBusService(prisma));
    const u = await prisma.user.findFirst({ select: { id: true } });
    actor = u?.id;

    const sup = await service.createSupplier({ name: `تست-تامین-${Date.now()}`, actorId: actor });
    supplierId = sup.id;
    const wh = await prisma.warehouse.findFirst({ where: { active: true } });
    if (!wh) throw new Error("انبار فعال یافت نشد");
    warehouseId = wh.id;

    // واریانت آزمایشی
    const cat = await prisma.category.findFirst();
    if (!cat) throw new Error("category از seed موجود نیست");
    const sku = `TEST-PRC-${Date.now()}`;
    const product = await prisma.product.create({
      data: { name: "تست خرید", slug: `test-prc-${Date.now()}`, categoryId: cat.id, basePrice: 200000n },
    });
    await prisma.productVariant.create({ data: { productId: product.id, sku, price: 200000n } });
    testSkus.push(sku);

    // PO (SENT) + GRN مرتبط — تا Three-Way Match با PPV واقعاً فعال شود
    const po = await service.createPO({
      supplierId,
      lines: [{ variantSku: sku, qty: 5, unitCost: 100000 }],
      actorId: actor,
    });
    await service.sendPO(po.id, actor);
    poId = po.id;

    // GRN — ۵ عدد به بهای ۱۰۰٬۰۰۰ (طبق PO)
    const grn = await service.createGRN({
      supplierId, warehouseId, poId,
      lines: [{ variantSku: sku, qty: 5, unitCost: 100000, landedCost: 0 }],
      actorId: actor,
    });
    grnId = grn.id;
  });

  afterAll(async () => {
    // پاکسازی به ترتیب وابستگی FK — فقط داده‌های TEST-PRC
    for (const id of createdInvoices) {
      await prisma.purchasePayment.deleteMany({ where: { invoiceId: id } });
      await prisma.accountsPayable.deleteMany({ where: { refType: "purchase_invoice", refId: id } });
      await prisma.purchaseInvoiceItem.deleteMany({ where: { invoiceId: id } });
      await prisma.purchaseInvoice.deleteMany({ where: { id } }).catch(() => undefined);
    }
    for (const sku of testSkus) {
      await prisma.stockLedgerEntry.deleteMany({ where: { variantSku: sku } });
      await prisma.costLayer.deleteMany({ where: { variantSku: sku } });
    }
    await prisma.goodsReceiptItem.deleteMany({ where: { receiptId: grnId } }).catch(() => undefined);
    await prisma.goodsReceipt.deleteMany({ where: { id: grnId } }).catch(() => undefined);
    if (poId) {
      await prisma.purchaseOrderItem.deleteMany({ where: { orderId: poId } }).catch(() => undefined);
      await prisma.purchaseOrder.deleteMany({ where: { id: poId } }).catch(() => undefined);
    }
    for (const sku of testSkus) {
      await prisma.productVariant.deleteMany({ where: { sku } }).catch(() => undefined);
    }
    await prisma.supplierAccount.deleteMany({ where: { supplierId } }).catch(() => undefined);
    await prisma.supplier.deleteMany({ where: { id: supplierId } }).catch(() => undefined);
    await prisma.auditLog.deleteMany({ where: { actorId: "test", action: { startsWith: "purchasing." } } }).catch(() => undefined);
    await prisma.journalEntry.deleteMany({ where: { sourceType: { in: ["purchase", "purchase_invoice", "purchase_payment"] } } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("فاکتور سالم ثبت می‌شود — POSTED + AP باز", async () => {
    const r = await service.createInvoice({
      supplierId, grnId,
      lines: [{ variantSku: testSkus[0], qty: 5, unitCost: 100000 }],
      shippingTotal: 20000, taxTotal: 0, note: "تست", actorId: actor,
    });
    createdInvoices.push(r.invoice.id);
    expect(r.invoice.state).toBe("POSTED");
    expect(r.invoice.grandTotal).toBe(520000n); // 5×100k + 20k
    expect(r.ppvLines).toHaveLength(0);

    const ap = await prisma.accountsPayable.findFirst({ where: { refType: "purchase_invoice", refId: r.invoice.id } });
    expect(ap).not.toBeNull();
    expect(ap!.amount).toBe(520000n);
  });

  it("عدم تطابق تعداد → THREE_WAY_MISMATCH رد می‌شود", async () => {
    await expect(
      service.createInvoice({
        supplierId, grnId,
        lines: [{ variantSku: testSkus[0], qty: 3, unitCost: 100000 }],
        actorId: actor,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("بهای متفاوت از GRN → PPV صریح اما ثبت می‌شود", async () => {
    const r = await service.createInvoice({
      supplierId, grnId,
      lines: [{ variantSku: testSkus[0], qty: 5, unitCost: 110000 }],
      actorId: actor,
    });
    createdInvoices.push(r.invoice.id);
    expect(r.ppvLines).toHaveLength(1);
    expect(r.ppvLines[0].poCost).toBe(100000);
    expect(r.ppvLines[0].invoiceCost).toBe(110000);
  });

  it("جزئیات فاکتور کامل است — snapshot + payments + AP + audit", async () => {
    const payFirst = createdInvoices[0];
    const d = await service.getInvoiceDetail(payFirst);
    expect(d.invoice.number).toMatch(/^PINV-/);
    expect(d.supplier.name).toContain("تست-تامین");
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0].productName).toBe("تست خرید");
    expect(d.totals.apAmount).toBe(520000);
    expect(d.totals.paidTotal).toBe(0);
    expect(d.totals.balance).toBe(520000);
    expect(d.inventoryImpact).toHaveLength(1);
    expect(d.inventoryImpact[0].qty).toBe(5);
    // audit از خود createInvoice باید ثبت شده باشد
    expect(d.audit.length).toBeGreaterThan(0);
    // GRN unitCost برای مغایرت
    expect(d.lines[0].grnUnitCost).toBe(100000n);
  });

  it("پرداخت جزیی → PARTIALLY_PAID + مانده درست؛ پرداخت بیش از کل → OVERPAY", async () => {
    const inv0 = createdInvoices[0];
    const r = await service.payInvoice({ invoiceId: inv0, amount: 20000, method: "transfer", actorId: actor });
    expect(r.state).toBe("PARTIALLY_PAID");
    expect(r.paid).toBe(20000);

    const d = await service.getInvoiceDetail(inv0);
    expect(d.totals.paidTotal).toBe(20000);
    expect(d.totals.balance).toBe(500000);
    expect(d.payments).toHaveLength(1);

    await expect(
      service.payInvoice({ invoiceId: inv0, amount: 10_000_000, actorId: actor }),
    ).rejects.toThrow(BadRequestException);
  });

  it("فاکتور ناموجود → NOT_FOUND", async () => {
    await expect(service.getInvoiceDetail("nonexistent-id")).rejects.toThrow(NotFoundException);
  });
});
