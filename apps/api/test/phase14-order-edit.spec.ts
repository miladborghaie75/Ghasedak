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

  it("1) ویرایش خطوط: تعداد 1→3 + افزودن SKU دوم → محاسبه دوباره + رزرو + ORDER_EDITED", async () => {
    const o = await makeOrder([{ sku: "DEMO-BRA-80B-BLK", qty: 1 }]);
    const before = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { items: true } });
    expect(before.items).toHaveLength(1);

    const edited = await orders.editOrder({
      orderId: o.id,
      actorId,
      reason: "تست ویرایش",
      lines: [{ sku: "DEMO-BRA-80B-BLK", qty: 3 }, { sku: "DEMO-BRA-75B-BLK", qty: 1 }],
    });

    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { items: true } });
    expect(after.items).toHaveLength(2);
    expect(after.total).toBe(edited.total);
    // محاسبه دوباره: subtotal جدید = total - shipping
    const lineSum = after.items.reduce((a, it) => a + Number(it.lineTotal), 0);
    expect(lineSum).toBe(Number(after.subtotal));
    // رزرو انبار به‌روز
    const res = await prisma.stockReservation.findMany({ where: { refType: "order", refId: o.id, state: "ACTIVE" } });
    const qty80 = res.filter((r) => r.variantSku === "DEMO-BRA-80B-BLK").reduce((a, r) => a + r.qty, 0);
    expect(qty80).toBe(3);
    // تاریخچه بازبینی
    const ev = await prisma.orderEvent.findFirstOrThrow({ where: { orderId: o.id, type: "ORDER_EDITED" } });
    const payload = ev.payload as { before: { total: number }; after: { total: number } };
    expect(payload.before.total).toBe(Number(before.total));
    expect(payload.after.total).toBe(Number(after.total));
    // رویداد ادمین
    const outbox = await prisma.domainEventOutbox.findFirst({ where: { name: "OrderEdited", payload: { path: ["orderId"], equals: o.id } } });
    expect(outbox).toBeTruthy();
  });

  it("2) سفارش پرداخت‌شده → ORDER_PAID ممنوع", async () => {
    const o = await makeOrder([{ sku: "DEMO-BRA-80B-BLK", qty: 1 }]);
    await prisma.order.update({ where: { id: o.id }, data: { paymentStatus: "PAID" } });
    await expect(orders.editOrder({ orderId: o.id, lines: [{ sku: "DEMO-BRA-80B-BLK", qty: 2 }] })).rejects.toMatchObject({ response: { code: "ORDER_PAID" } });
  });

  it("3) تعداد بیش از موجودی → INSUFFICIENT_STOCK و هیچ تغییر نمانده", async () => {
    const o = await makeOrder([{ sku: "DEMO-BRA-80B-BLK", qty: 1 }]);
    const totalBefore = (await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).total;
    // واریانتِ بدون ردیف دفتری (sellable صفر واقعی، زیر سقف ۹۹) را خودش می‌سازد؛
    // قبلاً به SKU دموی ردیف‌ندار تکیه داشت که با تعمیر موجودی آغازین دیگر صفر نیست.
    const host = await prisma.product.findFirstOrThrow({ where: { deletedAt: null } });
    const zeroSku = `ZLEDGER-${Date.now()}`;
    await prisma.productVariant.create({ data: { productId: host.id, sku: zeroSku, price: 1000n, stockQty: 0 } });
    try {
      await expect(orders.editOrder({ orderId: o.id, lines: [{ sku: zeroSku, qty: 50 }] })).rejects.toMatchObject({ response: { code: "INSUFFICIENT_STOCK" } });
      // هیچ تغییر نمانده باشد
      const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
      expect(after.total).toBe(totalBefore);
      const evCount = await prisma.orderEvent.count({ where: { orderId: o.id, type: "ORDER_EDITED" } });
      expect(evCount).toBe(0);
    } finally {
      await prisma.productVariant.delete({ where: { sku: zeroSku } }).catch(() => undefined);
    }
  });
});
