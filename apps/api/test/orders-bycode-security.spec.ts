/**
 * امنیت — by-code سفارش (ایدنیفیکیشن IDOR):
 *  کد سفارش از NumberSeries سریالی است (ORD-000058…) و قابل حدس؛ پس endpoint عمومی
 *  نباید PII (اسم/موبایل/آدرس) را برگرداند.
 *
 *  1) نسخهٔ عمومی (بدون هویت): فقط خلاصهٔ مالی + اقلام — هیچ guestName/guestMobile/addressSnapshot
 *  2) نسخهٔ ادمین (`orders.view` یا `*`): کامل (فاکتور چاپی ادمین به آن وابسته است)
 *  3) کنترلر: هویت null → عمومی؛ هویت دارای مجوز → کامل
 */
import "reflect-metadata";
import { PrismaService } from "../src/prisma/prisma.service";
import { OrdersService } from "../src/orders/orders.service";
import { OrdersController } from "../src/orders/orders.controller";
import { InventoryService } from "../src/inventory/inventory.service";
import { InventorySettingsService } from "../src/inventory/inventory-settings.service";
import { PricingService } from "../src/pricing/pricing.service";
import { EventBusService } from "../src/events/event-bus.service";

jest.setTimeout(120_000);

describe("Orders by-code — IDOR: عمومی بدون PII / ادمین کامل", () => {
  let prisma: PrismaService;
  let orders: OrdersService;
  let ctl: OrdersController;
  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const bus = new EventBusService(prisma);
    const inv = new InventoryService(prisma, new InventorySettingsService(prisma));
    const pricing = new PricingService(prisma, bus);
    orders = new OrdersService(prisma, inv, pricing);
    ctl = new OrdersController(orders);
  });

  afterAll(async () => {
    for (const id of createdOrderIds) {
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: id } }).catch(() => undefined);
      await prisma.orderEvent.deleteMany({ where: { orderId: id } }).catch(() => undefined);
      await prisma.orderItem.deleteMany({ where: { orderId: id } }).catch(() => undefined);
      await prisma.domainEventOutbox
        .deleteMany({ where: { name: "OrderCreated", payload: { path: ["orderId"], equals: id } } })
        .catch(() => undefined);
      await prisma.order.deleteMany({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  /** سفارش مهمان واقعی با PII مشخص — تراکنش سادهٔ مستقیم DB (بدون رزرو/قیمت) */
  async function makeOrder(tag: string) {
    const n = Math.floor(Math.random() * 900_000) + 100_000;
    return prisma.order.create({
      data: {
        code: `TSTSEC-${tag}-${n}`,
        guestName: `خریدار محرمانه ${tag}`,
        guestMobile: "09121234567",
        addressSnapshot: {
          province: "تهران",
          city: "تهران",
          address: "خیابان محرمانه، پلاک ۹",
          plaque: "9",
          postalCode: "1234567890",
        },
        status: "PENDING",
        paymentStatus: "PENDING",
        subtotal: 100_000n,
        shippingCost: 25_000n,
        total: 125_000n,
        notes: "یادداشت داخلی محرمانه",
      },
    });
  }

  it("نسخهٔ عمومی: بدون guestName/guestMobile/addressSnapshot/notes — با اقلام و مبالغ", async () => {
    const tag = `pub${Date.now().toString(36)}`;
    const order = await makeOrder(tag);
    createdOrderIds.push(order.id);

    const pub = (await orders.byCodePublic(order.code)) as Record<string, unknown> | null;
    expect(pub).toBeTruthy();
    expect(pub!.code).toBe(order.code);
    expect(pub!.total).toBeTruthy(); // مبلغ لازم صفحهٔ پرداخت است
    expect(Array.isArray(pub!.items)).toBe(true);

    // PII هرگز نباید در نسخهٔ عمومی باشد
    expect(pub!).not.toHaveProperty("guestName");
    expect(pub!).not.toHaveProperty("guestMobile");
    expect(pub!).not.toHaveProperty("addressSnapshot");
    expect(pub!).not.toHaveProperty("notes");
    expect(pub!).not.toHaveProperty("trackingCode");
  });

  it("نسخهٔ ادمین (byCode کامل): PII موجود — فاکتور چاپی به آن وابسته است", async () => {
    const tag = `adm${Date.now().toString(36)}`;
    const order = await makeOrder(tag);
    createdOrderIds.push(order.id);

    const full = (await orders.byCode(order.code)) as Record<string, unknown> | null;
    expect(full).toBeTruthy();
    expect(full!.guestName).toBe(order.guestName);
    expect(full!.guestMobile).toBe(order.guestMobile);
    expect(full!.addressSnapshot).toBeTruthy();
  });

  it("کنترلر: بدون هویت → عمومی؛ با orders.view → کامل؛ با * → کامل", async () => {
    const tag = `ctl${Date.now().toString(36)}`;
    const order = await makeOrder(tag);
    createdOrderIds.push(order.id);

    const anon = (await ctl.byCode(order.code, null)) as Record<string, unknown>;
    expect(anon).not.toHaveProperty("guestMobile");

    const viewer = (await ctl.byCode(order.code, { permissions: ["orders.view"] })) as Record<string, unknown>;
    expect(viewer.guestMobile).toBe(order.guestMobile);

    const root = (await ctl.byCode(order.code, { permissions: ["*"] })) as Record<string, unknown>;
    expect(root.guestMobile).toBe(order.guestMobile);

    // مجوز بی‌ربط → عمومی
    const other = (await ctl.byCode(order.code, { permissions: ["products.view"] })) as Record<string, unknown>;
    expect(other).not.toHaveProperty("guestMobile");
  });

  it("کد ناموجود → null (همان رفتار قبلی)", async () => {
    expect(await orders.byCodePublic("ORD-NOPE-999999")).toBeNull();
  });
});
