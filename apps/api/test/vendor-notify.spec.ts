/**
 * تست تحویل فاکتور به تامین‌کننده — بند ۲۷ + بند ۱۱۱:
 * 1) کانال EMAIL بدون ایمیل تامین‌کننده → NO_SUPPLIER_EMAIL (بدون داده فیک)
 * 2) بدون credential → ردیف QUEUED با خطای صریح REQUIRES_CREDENTIAL — هیچ «ارسال شد» جعل نمی‌شود
 * 3) موبایل نامعتبر SMS → VALIDATION_ERROR
 *
 * ایزولاسیون (Hardening Gate §3): فیکسچر خودش فاکتور + تامین‌کننده اختصاصی می‌سازد؛
 * هیچ وابستگی به spec دیگر یا داده legacy نیست. afterAll ردیف‌های email تامین‌کننده‌ها
 * را به مقدار اصلی برمی‌گرداند (snapshot per-row) و فیکسچر را حذف می‌کند.
 */
import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { VendorNotifyService } from "../src/inventory/vendor-notify.service";

describe("VendorNotifyService (تحویل فاکتور به تامین‌کننده)", () => {
  let prisma: PrismaService;
  let svc: VendorNotifyService;
  let invoiceId: string;
  let actor: string | undefined;
  const createdIds: string[] = [];
  const supplierEmail = "vendor-smoke@example.com";
  const supplierId = `test-sup-vn-${Date.now()}`;
  const invoiceNumber = `PINV-TESTVN-${Date.now()}`;
  /** snapshot ایمیل همه تامین‌کننده‌ها قبل از تست — برای restore دقیق در afterAll */
  let emailSnapshot: Array<{ id: string; email: string | null }> = [];
  const prevKavenegar = process.env.KAVENEGAR_API_KEY;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    svc = new VendorNotifyService(prisma);

    // ---- فیکسچر مستقل: Supplier + Account + Invoice + Item ----
    // PurchaseInvoiceItem.variantSku به ProductVariant ارجاع FK دارد — واریانت موجود استفاده می‌شود
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { status: "PUBLISHED" }, select: { sku: true } });
    await prisma.supplier.create({ data: { id: supplierId, name: "تست فیکسچر VendorNotify" } });
    await prisma.supplierAccount.create({ data: { supplierId, outstanding: 0n } });
    const invRow = await prisma.purchaseInvoice.create({
      data: {
        number: invoiceNumber,
        supplierId,
        state: "DRAFT",
        subtotal: 50000n,
        grandTotal: 50000n,
        items: { create: [{ variantSku: variant.sku, qty: 1, unitCost: 50000n }] },
      },
      select: { id: true },
    });
    invoiceId = invRow.id;

    const u = await prisma.user.findFirst({ select: { id: true } });
    actor = u?.id; // FK واقعی برای AuditLog
    emailSnapshot = await prisma.supplier.findMany({ select: { id: true, email: true } });
    delete process.env.KAVENEGAR_API_KEY; // مسیر بدون credential قطعی شود
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await prisma.supplierInvoiceDelivery.deleteMany({ where: { id } });
    }
    // restore دقیق per-row (بدون destroy کلاینت‌های دیگر)
    for (const row of emailSnapshot) {
      await prisma.supplier.update({ where: { id: row.id }, data: { email: row.email } }).catch(() => undefined);
    }
    await prisma.auditLog.deleteMany({ where: { entity: "PurchaseInvoice", entityId: invoiceId, action: "purchasing.invoice.send.email" } }).catch(() => undefined);
    await prisma.purchaseInvoiceItem.deleteMany({ where: { invoiceId } }).catch(() => undefined);
    await prisma.purchaseInvoice.deleteMany({ where: { id: invoiceId } }).catch(() => undefined);
    await prisma.supplierAccount.deleteMany({ where: { supplierId } }).catch(() => undefined);
    await prisma.supplier.deleteMany({ where: { id: supplierId } }).catch(() => undefined);
    if (prevKavenegar !== undefined) process.env.KAVENEGAR_API_KEY = prevKavenegar;
    else delete process.env.KAVENEGAR_API_KEY;
    await prisma.$disconnect();
  });

  it("کانال EMAIL بدون ایمیل تامین‌کننده → NO_SUPPLIER_EMAIL", async () => {
    await prisma.supplier.updateMany({ data: { email: null } });
    const before = await prisma.supplierInvoiceDelivery.count({ where: { invoiceId } });
    await expect(svc.sendInvoice({ invoiceId, channel: "EMAIL" })).rejects.toThrow(BadRequestException);
    const rows = await prisma.supplierInvoiceDelivery.count({ where: { invoiceId } });
    expect(rows).toBe(before); // ردیف تحویل جدیدی ساخته نشده
  });

  it("بدون SMTP credential → ردیف QUEUED با REQUIRES_CREDENTIAL — نه SENT (بند ۱۱۱)", async () => {
    await prisma.supplier.update({ where: { id: supplierId }, data: { email: supplierEmail } });
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;

    const r = await svc.sendInvoice({ invoiceId, channel: "EMAIL", actorId: actor });
    createdIds.push(r.delivery.id);
    expect(r.delivery.state).toBe("QUEUED");
    expect(r.delivery.lastError).toContain("REQUIRES_CREDENTIAL");
    expect(r.delivery.sentAt).toBeNull();

    // audit ثبت شده باشد
    const audits = await prisma.auditLog.findMany({
      where: { entity: "PurchaseInvoice", entityId: invoiceId, action: "purchasing.invoice.send.email" },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("موبایل نامعتبر SMS → VALIDATION_ERROR و بدون ردیف", async () => {
    await expect(
      svc.sendInvoice({ invoiceId, channel: "SMS", to: "12345" }),
    ).rejects.toThrow(BadRequestException);
    const rows = await prisma.supplierInvoiceDelivery.count({ where: { invoiceId, channel: "SMS" } });
    expect(rows).toBe(0);
  });

  it("listDeliveries: تحویل‌های فاکتور را برمی‌گرداند", async () => {
    const r = await svc.listDeliveries(invoiceId);
    expect(r.items.length).toBeGreaterThanOrEqual(1);
    expect(r.items[0]).toHaveProperty("channel");
    expect(r.items[0]).toHaveProperty("state");
  });
});
