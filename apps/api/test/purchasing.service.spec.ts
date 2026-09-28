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
import { JournalService } from "../src/accounting/journal.service";
import { TreasuryService } from "../src/treasury/treasury.service";
import { ChecksService } from "../src/checks/checks.service";

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
    service = new PurchasingService(prisma, inv, new EventBusService(prisma), new TreasuryService(prisma, new JournalService(prisma)), new ChecksService(prisma, new JournalService(prisma)));
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
    // پاک‌سازی کامل به ترتیب وابستگی FK — بدون swallow: شکست پاک‌سازی = شکست تست
    // (الگوی قبلی .catch(() => undefined) واریانت/محصول یتیم جا می‌گذاشت — STEP 4 ممنوع)
    // ۱) فاکتورها: پرداخت‌ها + AP + پیوست‌ها + اقلام + خود فاکتور
    for (const id of createdInvoices) {
      await prisma.purchasePayment.deleteMany({ where: { invoiceId: id } });
      await prisma.accountsPayable.deleteMany({ where: { refType: "purchase_invoice", refId: id } });
      await prisma.attachment.deleteMany({ where: { ownerType: "purchase_invoice", ownerId: id } });
      await prisma.purchaseInvoiceItem.deleteMany({ where: { invoiceId: id } });
      await prisma.purchaseInvoice.deleteMany({ where: { id } });
    }
    // ۲) Mediaهای پیوست تست (بعد از attachmentها — FK restrict)
    await prisma.media.deleteMany({ where: { storageKey: { startsWith: "test-att-" } } });
    // ۳) GRN و PO
    await prisma.goodsReceiptItem.deleteMany({ where: { receiptId: grnId } });
    await prisma.goodsReceipt.deleteMany({ where: { id: grnId } });
    if (poId) {
      await prisma.purchaseOrderItem.deleteMany({ where: { orderId: poId } });
      await prisma.purchaseOrder.deleteMany({ where: { id: poId } });
    }
    // ۴) واریانت تستی: PriceHistory/VariantPrice/Barcode/Ledger/CostLayer همه FK restrict هستند
    //    — همان دلیلی که delete قبلی (swallow شده) شکست می‌خورد و یتیم می‌گذاشت
    for (const sku of testSkus) {
      await prisma.priceHistory.deleteMany({ where: { variantSku: sku } });
      await prisma.variantPrice.deleteMany({ where: { variantSku: sku } });
      await prisma.variantBarcode.deleteMany({ where: { variantSku: sku } });
      await prisma.stockReservation.deleteMany({ where: { variantSku: sku } });
      await prisma.stockLedgerEntry.deleteMany({ where: { variantSku: sku } });
      await prisma.costLayer.deleteMany({ where: { variantSku: sku } });
    }
    // ۵) محصول تستی — بعد از حذف واریانت‌ها
    await prisma.productVariant.deleteMany({ where: { sku: { in: testSkus } } });
    await prisma.product.deleteMany({ where: { slug: { startsWith: "test-prc-" } } });
    // ۶) تامین‌کننده
    await prisma.supplierAccount.deleteMany({ where: { supplierId } });
    await prisma.supplier.deleteMany({ where: { id: supplierId } });
    // ۷) audit و journal این دامنه (خطاها swallow نمی‌شوند)
    await prisma.auditLog.deleteMany({ where: { action: { startsWith: "purchasing." } } });
    await prisma.journalEntry.deleteMany({ where: { sourceType: { in: ["purchase", "purchase_invoice", "purchase_payment"] } } });
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

  it("پیوست — attach/detach با audit و detail شامل mediaKey", async () => {
    const inv0 = createdInvoices[0];
    // Media واقعی بساز (PNG کوچک با magic bytes درست) — جدول Attachment به Media اشاره دارد
    const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
    const media = await prisma.media.create({
      data: { kind: "image", storageKey: `test-att-${Date.now()}.png`, mime: "image/png", sizeBytes: BigInt(png.length) },
    });
    const att = await service.addAttachment(inv0, media.id, "فاکتور تامین‌کننده", actor);
    expect(att.ownerType).toBe("purchase_invoice");

    let d = await service.getInvoiceDetail(inv0);
    expect(d.attachments).toHaveLength(1);
    expect(d.attachments[0].mediaKey).toBe(media.storageKey);

    await service.removeAttachment(att.id, actor);
    d = await service.getInvoiceDetail(inv0);
    expect(d.attachments).toHaveLength(0);

    await prisma.media.delete({ where: { id: media.id } });
    // audit attach/detach ثبت شده باشد
    const audits = await prisma.auditLog.findMany({ where: { entity: "PurchaseInvoice", entityId: inv0, action: { in: ["purchasing.invoice.attach", "purchasing.invoice.detach"] } } });
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });

  it("تعدیل گروهی قیمت BASE — delegation به PricingService و ثبت PriceHistory", async () => {
    const { PricingService } = await import("../src/pricing/pricing.service");
    const pricing = new PricingService(prisma, new EventBusService(prisma));
    const sku = testSkus[0];
    const before = await prisma.productVariant.findUnique({ where: { sku }, select: { price: true } });
    const r = await pricing.changePrice({
      skus: [sku],
      levelCode: "BASE",
      mode: "delta",
      amount: 1000,
      reason: "تست: تعدیل گروهی انبار",
      actorId: actor,
      source: "inventory-bulk",
    });
    expect(r.changed).toBe(1);
    expect(r.level).toBe("BASE");

    // آینه قیمت پایه هم به‌روز شده باشد
    const after = await prisma.productVariant.findUnique({ where: { sku }, select: { price: true } });
    expect(Number(after!.price)).toBe(Number(before!.price) + 1000);

    // رکورد تاریخچه با reason و actor
    const hist = await prisma.priceHistory.findFirst({
      where: { variantSku: sku, level: { code: "BASE" } },
      orderBy: { createdAt: "desc" },
    });
    expect(hist).not.toBeNull();
    expect(Number(hist!.newPrice)).toBe(Number(before!.price) + 1000);
    expect(hist!.reason).toBe("تست: تعدیل گروهی انبار");
  });
});
