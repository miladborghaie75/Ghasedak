/**
 * فاز ۱۴ بند ۶ — ویرایش حرفه‌ای سفارش:
 *  1) ویرایش خطوط پرداخت‌نشده → محاسبه دوباره از سرور + رزرو جدید + ORDER_EDITED در OrderEvent
 *  2) سفارش پرداخت‌شده → ممنوع (ORDER_PAID)
 *  3) موجودی ناکافی → رد با INSUFFICIENT_STOCK
 */
import "reflect-metadata";
import { PrismaService } from "../src/prisma/prisma.service";
import { InventoryService } from "../src/inventory/inventory.service";
import { InventorySettingsService } from "../src/inventory/inventory-settings.service";
import { PricingService } from "../src/pricing/pricing.service";
import { EventBusService } from "../src/events/event-bus.service";
import { OrdersService } from "../src/orders/orders.service";
import { execSync } from "node:child_process";

jest.setTimeout(120_000);

const DB = process.env.DATABASE_URL ?? "postgresql://postgres:rehearsal-pw@127.0.0.1:55433/p11dev";

function q(sql: string): Array<Record<string, unknown>> {
  const out = execSync(`cd C:/ghasedak-tools/pg-client && node one-off.mjs "${DB}" ${JSON.stringify(sql)}`, { encoding: "utf8" });
  return JSON.parse(out);
}

describe("Phase 14 item 6 — order edit", () => {
  let prisma: PrismaService;
  let orders: OrdersService;
  let actorId: string;
  let shippingMethodId: string;
  const createdOrderIds: string[] = [];
  const tag = `p14edit${Date.now()}`;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const bus = new EventBusService(prisma);
    const inv = new InventoryService(prisma, new InventorySettingsService(prisma));
    const pricing = new PricingService(prisma, bus);
    orders = new OrdersService(prisma, inv, pricing);
    const admin = await prisma.user.findFirst({ where: { email: "admin@ghasedak.demo" } });
    actorId = admin!.id;
    shippingMethodId = (await prisma.shippingMethod.findFirstOrThrow({ where: { status: "active" } })).id;
  });

  afterAll(async () => {
    // پاک‌سازی سفارش‌های تستی
    for (const id of createdOrderIds) {
      await prisma.stockReservation.deleteMany({ where: { refType: "order", refId: id } }).catch(() => undefined);
      await prisma.orderEvent.deleteMany({ where: { orderId: id } }).catch(() => undefined);
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: id } }).catch(() => undefined);
      await prisma.orderItem.deleteMany({ where: { orderId: id } }).catch(() => undefined);
      await prisma.domainEventOutbox.deleteMany({ where: { name: { in: ["OrderCreated", "OrderEdited"] }, payload: { path: ["orderId"], equals: id } } }).catch(() => undefined);
      await prisma.order.deleteMany({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  const makeOrder = async (skus: Array<{ sku: string; qty: number }>) => {
    const r = await orders.createGuestOrder({
      guestName: `تست ویرایش ${tag}`,
      guestMobile: `0914${String(Date.now()).slice(-7)}`,
      address: { province: "تهران", city: "تهران", address: "تست", plaque: "۱", postalCode: "1111111111" },
      shippingMethodId,
      lines: skus,
      idempotencyKey: `${tag}-${Math.random().toString(36).slice(2)}`,
    });
    createdOrderIds.push(r.id);
    return r;
  };

  // Helper to create a test variant with known stock
  const createTestVariant = async (sku: string, stock: number, price: bigint = 1000n) => {
    const host = await prisma.product.findFirstOrThrow({ where: { deletedAt: null } });
    await prisma.productVariant.create({ data: { productId: host.id, sku, price, stockQty: 0 } });
    // Seed stock via ledger OPENING (same as seed.ts)
    const wh = await prisma.warehouse.findUniqueOrThrow({ where: { code: "MAIN" } });
    const seedActor = await prisma.user.findUniqueOrThrow({ where: { email: "admin@ghasedak.demo" }, select: { id: true } });
    await prisma.$queryRaw`SELECT "sku" FROM "ProductVariant" WHERE "sku" = ${sku} FOR UPDATE`;
    const agg = await prisma.stockLedgerEntry.aggregate({
      where: { warehouseId: wh.id, variantSku: sku },
      _sum: { qtyIn: true, qtyOut: true },
    });
    const balanceBefore = (agg._sum.qtyIn ?? 0) - (agg._sum.qtyOut ?? 0);
    const balanceAfter = balanceBefore + stock;
    await prisma.stockLedgerEntry.create({
      data: {
        warehouseId: wh.id,
        variantSku: sku,
        type: "OPENING",
        qtyIn: stock,
        qtyOut: 0,
        balanceBefore,
        balanceAfter,
        unitCost: 500n,
        refType: "opening",
        refId: "test-seed",
        idempotencyKey: `test:opening:${sku}`,  // idempotent per test run
        actorId: seedActor.id,
        note: "موجودی تست واحد",
      },
    });
    await prisma.productVariant.update({ where: { sku }, data: { stockQty: stock } });
    // Create price for website channel
    const webLevel = await prisma.priceLevel.findUniqueOrThrow({ where: { code: "WEB" } });
    await prisma.variantPrice.upsert({
      where: { variantSku_priceLevelId: { variantSku: sku, priceLevelId: webLevel.id } },
      update: { price },
      create: { variantSku: sku, priceLevelId: webLevel.id, price },
    });
  };

  // Helper to clean up test variant
  const cleanupTestVariant = async (sku: string) => {
    await prisma.variantPrice.deleteMany({ where: { variantSku: sku } }).catch(() => undefined);
    await prisma.stockLedgerEntry.deleteMany({ where: { variantSku: sku, idempotencyKey: { startsWith: "test:opening:" } } }).catch(() => undefined);
    await prisma.productVariant.delete({ where: { sku } }).catch(() => undefined);
  };

  it("1) ویرایش خطوط: تعداد 1→3 + افزودن SKU دوم → محاسبه دوباره + رزرو + ORDER_EDITED", async () => {
    const sku1 = `TEST-EDIT-1-${Date.now()}`;
    const sku2 = `TEST-EDIT-2-${Date.now()}`;
    await createTestVariant(sku1, 10);
    await createTestVariant(sku2, 10);
    try {
      const o = await makeOrder([{ sku: sku1, qty: 1 }]);
      const before = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { items: true } });
      expect(before.items).toHaveLength(1);

      const edited = await orders.editOrder({
        orderId: o.id,
        actorId,
        reason: "تست ویرایش",
        lines: [{ sku: sku1, qty: 3 }, { sku: sku2, qty: 1 }],
      });

      const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { items: true } });
      expect(after.items).toHaveLength(2);
      expect(after.total).toBe(edited.total);
      // محاسبه دوباره: subtotal جدید = total - shipping
      const lineSum = after.items.reduce((a, it) => a + Number(it.lineTotal), 0);
      expect(lineSum).toBe(Number(after.subtotal));
      // رزرو انبار به‌روز
      const res = await prisma.stockReservation.findMany({ where: { refType: "order", refId: o.id, state: "ACTIVE" } });
      const qty1 = res.filter((r) => r.variantSku === sku1).reduce((a, r) => a + r.qty, 0);
      expect(qty1).toBe(3);
      // تاریخچه بازبینی
      const ev = await prisma.orderEvent.findFirstOrThrow({ where: { orderId: o.id, type: "ORDER_EDITED" } });
      const payload = ev.payload as { before: { total: number }; after: { total: number } };
      expect(payload.before.total).toBe(Number(before.total));
      expect(payload.after.total).toBe(Number(after.total));
      // رویداد ادمین
      const outbox = await prisma.domainEventOutbox.findFirst({ where: { name: "OrderEdited", payload: { path: ["orderId"], equals: o.id } } });
      expect(outbox).toBeTruthy();
    } finally {
      await cleanupTestVariant(sku1);
      await cleanupTestVariant(sku2);
    }
  });

  it("2) سفارش پرداخت‌شده → ORDER_PAID ممنوع", async () => {
    const sku = `TEST-PAID-${Date.now()}`;
    await createTestVariant(sku, 10);
    try {
      const o = await makeOrder([{ sku, qty: 1 }]);
      await prisma.order.update({ where: { id: o.id }, data: { paymentStatus: "PAID" } });
      await expect(orders.editOrder({ orderId: o.id, lines: [{ sku, qty: 2 }] })).rejects.toMatchObject({ response: { code: "ORDER_PAID" } });
    } finally {
      await cleanupTestVariant(sku);
    }
  });

  it("3) تعداد بیش از موجودی → INSUFFICIENT_STOCK و هیچ تغییر نمانده", async () => {
    const sku1 = `TEST-INSUFF-1-${Date.now()}`;
    const zeroSku = `TEST-INSUFF-0-${Date.now()}`;
    await createTestVariant(sku1, 10);
    await createTestVariant(zeroSku, 0);
    try {
      const o = await makeOrder([{ sku: sku1, qty: 1 }]);
      const totalBefore = (await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).total;
      await expect(orders.editOrder({ orderId: o.id, lines: [{ sku: zeroSku, qty: 50 }] })).rejects.toMatchObject({ response: { code: "INSUFFICIENT_STOCK" } });
      // هیچ تغییر نمانده باشد
      const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
      expect(after.total).toBe(totalBefore);
      const evCount = await prisma.orderEvent.count({ where: { orderId: o.id, type: "ORDER_EDITED" } });
      expect(evCount).toBe(0);
    } finally {
      await cleanupTestVariant(sku1);
      await cleanupTestVariant(zeroSku);
    }
  });
});
