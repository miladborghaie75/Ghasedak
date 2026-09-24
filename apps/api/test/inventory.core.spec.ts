/**
 * تست‌های یکپارچه موتور انبار — بند ۱۲/۱۴/۱۸/۹۱/۹۲/۱۱۶:
 * اتمیک بودن، idempotency، ممنوعیت موجودی منفی، انتقال بین‌انباری،
 * قرنطینه، خرابی، WAC. با DB واقعی dev اجرا می‌شود (مانند journal.service.spec).
 */
import { ConflictException, BadRequestException } from "@nestjs/common";
import { InventoryService } from "../src/inventory/inventory.service";
import { InventorySettingsService } from "../src/inventory/inventory-settings.service";
import { InventoryOpsService } from "../src/inventory/inventory-ops.service";
import { PrismaService } from "../src/prisma/prisma.service";

describe("InventoryService (integration با DB dev)", () => {
  let prisma: PrismaService;
  let service: InventoryService;
  let ops: InventoryOpsService;
  let warehouseId: string;
  let warehouse2Id: string;
  const skus: string[] = [];

  async function makeVariant(tag: string): Promise<string> {
    const sku = `TEST-INV-${tag}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const product = await prisma.product.create({
      data: {
        name: `تست انبار ${tag}`,
        slug: `test-inv-${tag}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        categoryId: categoryId,
        basePrice: 100000n,
      },
    });
    await prisma.productVariant.create({
      data: { productId: product.id, sku, price: 100000n, stockQty: 0 },
    });
    skus.push(sku);
    return sku;
  }

  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const settings = new InventorySettingsService(prisma);
    service = new InventoryService(prisma, settings);
    ops = new InventoryOpsService(prisma, service);
    // انبار آزمایشی
    const wh = await ops.createWarehouse({
      code: `TST${Date.now() % 100000}`,
      name: "انبار تست",
      type: "main",
    });
    warehouseId = wh.id;
    const wh2 = await ops.createWarehouse({
      code: `TST2${Date.now() % 100000}`,
      name: "انبار تست ۲",
      type: "store",
    });
    warehouse2Id = wh2.id;
    const cat = await prisma.category.findFirst();
    if (!cat) throw new Error("category از seed موجود نیست");
    categoryId = cat.id;
  });

  afterAll(async () => {
    // پاکسازی به ترتیب وابستگی FK — داده‌های آزمایشی TEST-INV فقط
    for (const sku of skus) {
      await prisma.stockReservation.deleteMany({ where: { variantSku: sku } });
      await prisma.stockTransferItem.deleteMany({ where: { variantSku: sku } });
      await prisma.stockLedgerEntry.deleteMany({ where: { variantSku: sku } });
      await prisma.quarantineRecord.deleteMany({ where: { variantSku: sku } });
      await prisma.damageRecord.deleteMany({ where: { variantSku: sku } });
      await prisma.costLayer.deleteMany({ where: { variantSku: sku } });
      await prisma.reorderPolicy.deleteMany({ where: { variantSku: sku } });
      await prisma.productVariant.deleteMany({ where: { sku } });
    }
    await prisma.stockTransfer.deleteMany({
      where: { OR: [{ fromWarehouseId: { in: [warehouseId, warehouse2Id] } }, { toWarehouseId: { in: [warehouseId, warehouse2Id] } }] },
    });
    await prisma.stocktakeItem.deleteMany({ where: { variantSku: { startsWith: "TEST-INV-" } } });
    await prisma.warehouse.deleteMany({ where: { id: { in: [warehouseId, warehouse2Id] } } });
    await prisma.auditLog.deleteMany({ where: { action: { startsWith: "inventory." } } });
    await prisma.$disconnect();
  });

  it("OPENING + مصرف + idempotency کامل", async () => {
    const sku = await makeVariant("idem");
    await service.move({
      warehouseId, variantSku: sku, type: "OPENING", qty: 10,
      idempotencyKey: `test:${sku}:open`,
    });
    // کلید تکراری → دوبار کم/اضافه نمی‌شود
    const again = await service.move({
      warehouseId, variantSku: sku, type: "OPENING", qty: 10,
      idempotencyKey: `test:${sku}:open`,
    });
    const st = await service.available(warehouseId, sku);
    expect(st.onHand).toBe(10);
    expect(again.balanceAfter).toBe(10);
  });

  it("موجودی منفی هرگز — ConflictException و اثر نکردن Ledger", async () => {
    const sku = await makeVariant("neg");
    await service.move({ warehouseId, variantSku: sku, type: "OPENING", qty: 3, idempotencyKey: `test:${sku}:o` });
    await expect(
      service.move({ warehouseId, variantSku: sku, type: "SALE", qty: 5, idempotencyKey: `test:${sku}:s` }),
    ).rejects.toThrow(ConflictException);
    const st = await service.available(warehouseId, sku);
    expect(st.onHand).toBe(3);
  });

  it("Concurrency — دو فروش هم‌زمان روی موجودی ۱ فقط یکی موفق", async () => {
    const sku = await makeVariant("race");
    await service.move({ warehouseId, variantSku: sku, type: "OPENING", qty: 1, idempotencyKey: `test:${sku}:o` });
    const results = await Promise.allSettled([
      service.move({ warehouseId, variantSku: sku, type: "SALE", qty: 1, idempotencyKey: `test:${sku}:a` }),
      service.move({ warehouseId, variantSku: sku, type: "SALE", qty: 1, idempotencyKey: `test:${sku}:b` }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const st = await service.available(warehouseId, sku);
    expect(st.onHand).toBe(0);
  });

  it("انتقال بین‌انباری DRAFT→IN_TRANSIT→DONE و منع دریافت پیش از ارسال", async () => {
    const sku = await makeVariant("trf");
    await service.move({ warehouseId, variantSku: sku, type: "OPENING", qty: 7, idempotencyKey: `test:${sku}:o` });
    const t = await ops.createTransfer({
      fromWarehouseId: warehouseId, toWarehouseId: warehouse2Id,
      lines: [{ variantSku: sku, qty: 4 }],
    });
    // دریافت پیش از ارسال ممنوع
    await expect(ops.receiveTransfer(t.id)).rejects.toThrow(BadRequestException);
    await ops.confirmTransfer(t.id);
    // ارسال دوباره ممنوع
    await expect(ops.confirmTransfer(t.id)).rejects.toThrow(BadRequestException);
    await ops.receiveTransfer(t.id);
    const a = await service.available(warehouseId, sku);
    const b = await service.available(warehouse2Id, sku);
    expect(a.onHand).toBe(3);
    expect(b.onHand).toBe(4);
  });

  it("انتقال بدون موجودی کافی رد می‌شود", async () => {
    const sku = await makeVariant("trf2");
    await service.move({ warehouseId, variantSku: sku, type: "OPENING", qty: 2, idempotencyKey: `test:${sku}:o` });
    const t = await ops.createTransfer({
      fromWarehouseId: warehouseId, toWarehouseId: warehouse2Id,
      lines: [{ variantSku: sku, qty: 5 }],
    });
    await expect(ops.confirmTransfer(t.id)).rejects.toThrow(ConflictException);
    await ops.cancelTransfer(t.id);
  });

  it("قرنطینه — کسر از قابل‌فروش بدون تغییر OnHand، بازگشت و انهدام", async () => {
    const sku = await makeVariant("qrn");
    await service.move({ warehouseId, variantSku: sku, type: "OPENING", qty: 10, idempotencyKey: `test:${sku}:open-${Date.now()}` });
    const rec = await ops.quarantineHold({
      warehouseId, variantSku: sku, qty: 3, reason: "تست کیفی",
    });
    let st = await service.available(warehouseId, sku);
    expect(st.onHand).toBe(10);
    expect(st.quarantine).toBe(3);
    expect(st.available).toBe(7);
    // بازگشت
    await ops.quarantineRelease(rec.id);
    st = await service.available(warehouseId, sku);
    expect(st.quarantine).toBe(0);
    expect(st.available).toBe(10);
    // انهدام
    const rec2 = await ops.quarantineHold({ warehouseId, variantSku: sku, qty: 2, reason: "تست" });
    const destroyed = await ops.quarantineDestroy(rec2.id);
    st = await service.available(warehouseId, sku);
    expect(st.onHand).toBe(8);
    expect(st.available).toBe(8);
    expect(destroyed.value).toBeGreaterThanOrEqual(0);
    const dmg = await prisma.damageRecord.findFirst({ where: { refId: rec2.id } });
    expect(dmg).not.toBeNull();
  });

  it("خرابی POSTED از انبار کم می‌کند؛ DRAFT کم نمی‌کند تا post شود", async () => {
    const sku = await makeVariant("dmg");
    await service.move({ warehouseId, variantSku: sku, type: "OPENING", qty: 6, idempotencyKey: `test:${sku}:o` });
    const draft = await ops.reportDamage({
      warehouseId, variantSku: sku, qty: 1, kind: "damage", holdForApproval: true,
    });
    expect((await service.available(warehouseId, sku)).onHand).toBe(6);
    await ops.postDamage(draft.id);
    expect((await service.available(warehouseId, sku)).onHand).toBe(5);
    const posted = await ops.reportDamage({
      warehouseId, variantSku: sku, qty: 2, kind: "loss",
    });
    expect(posted.state).toBe("POSTED");
    expect((await service.available(warehouseId, sku)).onHand).toBe(3);
  });

  it("WAC — میانگین موزون پس از دو ورود بهایی", async () => {
    const sku = await makeVariant("wac");
    await prisma.$transaction(async (tx) => {
      await service.moveInTx(tx, { warehouseId, variantSku: sku, type: "PURCHASE", qty: 4, unitCost: 10000n, idempotencyKey: `test:${sku}:p1` });
      await service.updateWacInTx(tx, warehouseId, sku, 4, 10000n);
    });
    await prisma.$transaction(async (tx) => {
      await service.moveInTx(tx, { warehouseId, variantSku: sku, type: "PURCHASE", qty: 6, unitCost: 20000n, idempotencyKey: `test:${sku}:p2` });
      await service.updateWacInTx(tx, warehouseId, sku, 6, 20000n);
    });
    // (4×10k + 6×20k)/10 = 16000
    const wac = await prisma.$transaction((tx) => service.wacInTx(tx, warehouseId, sku));
    expect(wac).toBe(16000n);
  });

  it("reserve → available کم می‌شود؛ consume → SALE در Ledger؛ رزرو منقضی آزاد", async () => {
    const sku = await makeVariant("res");
    await service.move({ warehouseId, variantSku: sku, type: "OPENING", qty: 5, idempotencyKey: `test:${sku}:o` });
    // StockReservation به Order اشاره می‌کند (FK) — سفارش آزمایشی می‌سازیم
    const order = await prisma.order.create({
      data: {
        code: `TEST-ORD-${Date.now()}`,
        addressSnapshot: { line: "تست" },
        subtotal: 100000n, shippingCost: 0n, total: 100000n,
      },
    });
    await service.reserve({
      warehouseId, lines: [{ variantSku: sku, qty: 2 }],
      refType: "order", refId: order.id, ttlMinutes: 60,
    });
    let st = await service.available(warehouseId, sku);
    expect(st.reserved).toBe(2);
    expect(st.available).toBe(3);
    // مصرف → SALE در Ledger + OnHand کم
    await service.consumeReservation({ warehouseId, refId: order.id });
    st = await service.available(warehouseId, sku);
    expect(st.onHand).toBe(3);
    expect(st.reserved).toBe(0);
    // مصرف دوباره — idempotent
    await service.consumeReservation({ warehouseId, refId: order.id });
    expect((await service.available(warehouseId, sku)).onHand).toBe(3);
    await prisma.order.delete({ where: { id: order.id } }).catch(() => undefined);
  });

  it("تنظیمات — مقدار نامعتبر رد می‌شود و default خوانده می‌شود", async () => {
    const { InventorySettingsService: S } = await import("../src/inventory/inventory-settings.service");
    const s = new S(prisma);
    const dead = await s.get<number>("deadStockDays");
    expect(dead).toBeGreaterThanOrEqual(7);
    await expect(s.set("deadStockDays", 1)).rejects.toThrow(BadRequestException);
    await expect(s.set("کلید_ناشناخته", 1)).rejects.toThrow(BadRequestException);
  });
});
