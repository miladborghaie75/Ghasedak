/**
 * تست تحویل فاکتور به تامین‌کننده — بند ۲۷ + بند ۱۱۱:
 * 1) کانال EMAIL بدون ایمیل تامین‌کننده → NO_SUPPLIER_EMAIL (بدون داده فیک)
 * 2) بدون credential → ردیف QUEUED با خطای صریح REQUIRES_CREDENTIAL — هیچ «ارسال شد» جعل نمی‌شود
 * 3) موبایل نامعتبر SMS → VALIDATION_ERROR
 * با DB واقعی dev — آخرین فاکتور موجود استفاده می‌شود (ساخت سند جدید لازم نیست).
 */
import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { VendorNotifyService } from "../src/inventory/vendor-notify.service";

describe("VendorNotifyService (تحویل فاکتور به تامین‌کننده)", () => {
  let prisma: PrismaService;
  let svc: VendorNotifyService;
  let invoiceId: string;
  let actor: string | undefined;
  const supplierEmail = "vendor-smoke@example.com";
  const createdIds: string[] = [];
  const prevKavenegar = process.env.KAVENEGAR_API_KEY;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    svc = new VendorNotifyService(prisma);
    const inv = await prisma.purchaseInvoice.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } });
    if (!inv) throw new Error("هیچ فاکتور خریدی در DB نیست — purchasing.service.spec اجرا شود");
    invoiceId = inv.id;
    const u = await prisma.user.findFirst({ select: { id: true } });
    actor = u?.id; // FK واقعی برای AuditLog
    delete process.env.KAVENEGAR_API_KEY; // مسیر بدون credential قطعی شود
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await prisma.supplierInvoiceDelivery.deleteMany({ where: { id } });
    }
    await prisma.supplier.updateMany({ where: { email: supplierEmail }, data: { email: null } });
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
    const sup = await prisma.purchaseInvoice.findUnique({ where: { id: invoiceId }, select: { supplierId: true } });
    await prisma.supplier.update({ where: { id: sup!.supplierId }, data: { email: supplierEmail } });
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
