/**
 * Smoke چاپ و پیوست فاکتور خرید (Phase 6 closure):
 * 1) سطح BASE از seed موجود است (پیش‌نیاز bulk-price جدید)
 * 2) attach پیوست با Media واقعی → detail شامل mediaKey (URL درست /api/media/:storageKey)
 * 3) تغییر قیمت WEB (معادل مسیر ادمین changePrice) → رکورد PriceHistory با actor/source
 * با DB واقعی dev — اجرای سریع، بدون ساخت سند خرید جدید.
 */
import { PrismaService } from "../src/prisma/prisma.service";
import { PurchasingService } from "../src/inventory/purchasing.service";
import { InventoryService } from "../src/inventory/inventory.service";
import { InventorySettingsService } from "../src/inventory/inventory-settings.service";
import { EventBusService } from "../src/events/event-bus.service";
import { JournalService } from "../src/accounting/journal.service";
import { TreasuryService } from "../src/treasury/treasury.service";
import { PricingService } from "../src/pricing/pricing.service";

describe("Phase 6 closure smoke (پرینت/پیوست/یکسان‌سازی قیمت)", () => {
  let prisma: PrismaService;
  let purchasing: PurchasingService;
  let pricing: PricingService;
  let actor: string | undefined;
  let invoiceId: string | undefined;
  const mediaIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const inv = new InventoryService(prisma, new InventorySettingsService(prisma));
    purchasing = new PurchasingService(prisma, inv, new EventBusService(prisma), new TreasuryService(prisma, new JournalService(prisma)));
    pricing = new PricingService(prisma, new EventBusService(prisma));
    const u = await prisma.user.findFirst({ select: { id: true } });
    actor = u?.id;

    // یک فاکتور واقعی موجود را انتخاب کن (از تست purchasing یا smoke قبلی)
    const inv0 = await prisma.purchaseInvoice.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } });
    if (!inv0) throw new Error("هیچ فاکتور خریدی در DB نیست — ابتدا purchasing.service.spec اجرا شود");
    invoiceId = inv0.id;
  });

  afterAll(async () => {
    for (const id of mediaIds) {
      await prisma.attachment.deleteMany({ where: { mediaId: id } });
      await prisma.media.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("سطح قیمت BASE از seed موجود است", async () => {
    const base = await prisma.priceLevel.findUnique({ where: { code: "BASE" } });
    expect(base).not.toBeNull();
    expect(base!.active).toBe(true);
  });

  it("پیوست: attach → detail شامل mediaKey → detach → audit ثبت شده", async () => {
    const media = await prisma.media.create({
      data: { kind: "image", storageKey: `smoke-att-${Date.now()}.png`, mime: "image/png", sizeBytes: 4n },
    });
    mediaIds.push(media.id);

    const att = await purchasing.addAttachment(invoiceId!, media.id, "فاکتور تامین‌کننده", actor);
    expect(att.ownerType).toBe("purchase_invoice");

    const d = await purchasing.getInvoiceDetail(invoiceId!);
    expect(d.attachments.length).toBeGreaterThan(0);
    const found = d.attachments.find((a) => a.id === att.id);
    expect(found).toBeDefined();
    expect(found!.mediaKey).toBe(media.storageKey);

    await purchasing.removeAttachment(att.id, actor);
    const audits = await prisma.auditLog.findMany({
      where: { entity: "PurchaseInvoice", entityId: invoiceId, action: { in: ["purchasing.invoice.attach", "purchasing.invoice.detach"] } },
    });
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });

  it("تغییر قیمت WEB — مسیر واحد changePrice → PriceHistory با actor و reason", async () => {
    const v = await prisma.productVariant.findFirst({
      where: { status: "PUBLISHED", product: { deletedAt: null } },
      orderBy: { sku: "asc" },
      select: { sku: true },
    });
    if (!v) throw new Error("واریانت PUBLISHED موجود نیست");
    const before = await prisma.productVariant.findUnique({ where: { sku: v.sku }, select: { price: true } });

    await pricing.changePrice({
      skus: [v.sku],
      levelCode: "WEB",
      mode: "delta",
      amount: 1000,
      reason: "smoke: تغییر قیمت مسیر واحد",
      actorId: actor,
      source: "inventory-bulk",
    });

    const hist = await prisma.priceHistory.findFirst({
      where: { variantSku: v.sku, level: { code: "WEB" } },
      orderBy: { createdAt: "desc" },
    });
    expect(hist).not.toBeNull();
    expect(hist!.reason).toBe("smoke: تغییر قیمت مسیر واحد");
    expect(hist!.actorId).toBe(actor);

    // برای BASE: آینه productVariant.price به‌روز می‌شود
    const baseHist = await prisma.priceHistory.findFirst({
      where: { variantSku: v.sku, level: { code: "BASE" }, reason: "smoke: قیمت پایه" },
    });
    expect(baseHist).toBeNull(); // قیمت پایه تغییر نکرده — فقط WEB

    const after = await prisma.productVariant.findUnique({ where: { sku: v.sku }, select: { price: true } });
    expect(after!.price).toBe(before!.price); // پایه دست‌نخورده برای WEB
    void prisma; void pricing;
  });
});
