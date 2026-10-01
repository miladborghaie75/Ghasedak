/**
 * موج ۱ — مسیر واقعی فروشگاه: محصول با موجودی آغازین از createFull باید
 * «قابل خرید» باشد. باگ واقعی موج ۱: createFull فقط stockQty می‌نوشت و دفتر
 * انبار (StockLedgerEntry) خالی می‌ماند؛ چک موجودی سفارش روی دفتر است ⇒
 * اولین سفارش مشتری با INSUFFICIENT_STOCK رد می‌شد در حالی که UI «موجود» نشان
 * می‌داد. تعمیر: ثبت OPENING هم‌تراکنش + خرید تا تخلیه کامل + رد خرید بعدی.
 * روی rehearsal اجرا می‌شود؛ ردیف‌های خودش را می‌سازد و پاک می‌کند.
 */
import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { ProductsService } from "../src/products/products.service";
import { OrdersService } from "../src/orders/orders.service";
import { PricingService } from "../src/pricing/pricing.service";
import { EventBusService } from "../src/events/event-bus.service";
import { InventoryService } from "../src/inventory/inventory.service";
import { InventorySettingsService } from "../src/inventory/inventory-settings.service";

jest.setTimeout(120_000);

describe("Phase 14 wave1 — product opening stock is purchasable", () => {
  let prisma: PrismaService;
  let products: ProductsService;
  let orders: OrdersService;
  let shippingMethodId: string;
  const cleanup: Array<{ products: string[]; variants: string[]; categoryId: string; orderIds: string[] }> = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    products = new ProductsService(prisma);
    const inventory = new InventoryService(prisma, new InventorySettingsService(prisma));
    orders = new OrdersService(prisma, inventory, new PricingService(prisma, new EventBusService(prisma)));
    // روش ارسال واقعی از DB — همان قرارداد اندپوینت عمومی /shipping/methods
    const method = await prisma.shippingMethod.findFirst({ where: { status: "active" }, orderBy: { sortOrder: "asc" } });
    if (!method) throw new Error("هیچ روش ارسال فعالی در rehearsal نیست");
    shippingMethodId = method.id;
  });

  afterAll(async () => {
    for (const c of cleanup) {
      await prisma.stockReservation.deleteMany({ where: { variantSku: { in: c.variants } } }).catch(() => undefined);
      await prisma.orderItem.deleteMany({ where: { orderId: { in: c.orderIds } } }).catch(() => undefined);
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: c.orderIds } } }).catch(() => undefined);
      await prisma.domainEventOutbox.deleteMany({ where: { payload: { path: ["orderId"], equals: { in: c.orderIds } } } }).catch(() => undefined);
      await prisma.order.deleteMany({ where: { id: { in: c.orderIds } } }).catch(() => undefined);
      await prisma.stockLedgerEntry.deleteMany({ where: { variantSku: { in: c.variants } } }).catch(() => undefined);
      await prisma.productVariant.deleteMany({ where: { sku: { in: c.variants } } }).catch(() => undefined);
      await prisma.product.deleteMany({ where: { id: { in: c.products } } }).catch(() => undefined);
      await prisma.category.delete({ where: { id: c.categoryId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("محصول با موجودی آغازین مستقیم قابل خرید است و خرید بعدی رد می‌شود", async () => {
    const tag = `${Date.now()}`;
    const cat = await prisma.category.create({ data: { name: `تست خرید ${tag}`, slug: `tb-${tag}`, status: "PUBLISHED" } });
    const entry = { products: [] as string[], variants: [] as string[], categoryId: cat.id, orderIds: [] as string[] };
    cleanup.push(entry);

    const created = (await products.createFull({
      name: `محصول خرید ${tag}`,
      slug: `tbuy-${tag}`,
      categoryId: cat.id,
      basePrice: 250_000,
      status: "PUBLISHED",
      variants: [{ sku: `TBUY-${tag}`, price: 250_000, stockQty: 1 }],
    })) as { id: string };

    entry.products.push(created.id);
    entry.variants.push(`TBUY-${tag}`);

    // ردیف OPENING با تراز درست در دفتر ثبت شده باشد
    const ledger = await prisma.stockLedgerEntry.findUnique({ where: { idempotencyKey: `opening:TBUY-${tag}` } });
    expect(ledger).not.toBeNull();
    expect(ledger!.type).toBe("OPENING");
    expect(ledger!.qtyIn).toBe(1);
    expect(ledger!.balanceAfter).toBe(1);
    expect(ledger!.warehouseId).toBeTruthy();

    // اولین سفارش مهمان باید موفق شود (قبلاً 400 می‌خورد)
    const idem = `w1-open-${tag}`;
    const order = await orders.createGuestOrder({
      guestName: "خریدار آزمون",
      guestMobile: "09140001122",
      address: { province: "تهران", city: "تهران", address: "خیابان آزمون پلاک ۱", plaque: "۱", postalCode: "1234567890" },
      shippingMethodId,
      couponCode: null,
      lines: [{ sku: `TBUY-${tag}`, qty: 1 }],
      idempotencyKey: idem,
    });
    expect(order.code).toMatch(/^ORD-/);
    entry.orderIds.push(order.id);

    // تخلیه انبار ⇒ خرید بعدی باید رد شود (ردیف دفتری جدیدی از سوی این تست ساخته نشد)
    await expect(
      orders.createGuestOrder({
        guestName: "خریدار آزمون",
        guestMobile: "09140001122",
        address: { province: "تهران", city: "تهران", address: "خیابان آزمون پلاک ۱", plaque: "۱", postalCode: "1234567890" },
        shippingMethodId,
        couponCode: null,
        lines: [{ sku: `TBUY-${tag}`, qty: 1 }],
        idempotencyKey: `w1-open2-${tag}`,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
