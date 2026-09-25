/**
 * تست‌های Pricing — بند ۱۲/۱۳/۱۵: منبع واحد قیمت کانالی، history، salePrice guard.
 * با DB واقعی dev اجرا می‌شود (مانند journal.service.spec).
 */
import { BadRequestException } from "@nestjs/common";
import { PricingService } from "../src/pricing/pricing.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { EventBusService } from "../src/events/event-bus.service";

const prisma = new PrismaService();
const bus = new EventBusService(prisma);
const svc = new PricingService(prisma, bus);

const LEVEL = "WEB";
/** SKU از DB واقعی — تست مستقل از seed نیست؛ در beforeAll انتخاب می‌شود */
let SKU = "";

beforeAll(async () => {
  const v = await prisma.productVariant.findFirst({
    where: { status: "PUBLISHED" },
    orderBy: { sku: "asc" },
    select: { sku: true },
  });
  if (!v) throw new Error("هیچ واریانت PUBLISHED در DB نیست — seed اجرا نشده؟");
  SKU = v.sku;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("PricingService", () => {
  it("effectivePrice: قیمت WEB واریانت را از VariantPrice برمی‌گرداند", async () => {
    const r = await svc.effectivePrice(SKU, "website");
    expect(r.price).toBeGreaterThan(0n);
    expect(r.channel).toBe("website");
  });

  it("effectivePrice: کانال ناموجود → CHANNEL_INACTIVE", async () => {
    await expect(svc.effectivePrice(SKU, "no-such-channel")).rejects.toThrow(BadRequestException);
  });

  it("channelFeed: فقط قیمت سطح همان کانال + بدون cost — و همه اقلام قیمت دارند", async () => {
    const feed = await svc.channelFeed("website", { limit: "10" });
    expect(feed.items.length).toBeGreaterThan(0);
    for (const it of feed.items) {
      expect(Number(it.price)).toBeGreaterThan(0);
      expect(it).not.toHaveProperty("costPrice");
      expect(it).not.toHaveProperty("levels");
    }
  });

  it("changePrice absolute: قیمت تغییر می‌کند و PriceHistory رکورد می‌گیرد", async () => {
    const before = await svc.effectivePrice(SKU, "website");
    const r = await svc.changePrice({
      skus: [SKU],
      levelCode: LEVEL,
      mode: "absolute",
      amount: 123456,
      reason: "تست: قیمت قطعی",
      actorId: "test-actor",
      source: "test",
    });
    expect(r.changed).toBe(1);

    const after = await svc.effectivePrice(SKU, "website");
    expect(after.price).toBe(123456n);

    const hist = await svc.history(SKU, LEVEL);
    expect(hist.items.length).toBeGreaterThan(0);
    expect(hist.items[0].newPrice).toBe(123456n);
    expect(hist.items[0].reason).toBe("تست: قیمت قطعی");
    expect(hist.items[0].actorId).toBe("test-actor");
    void before;
  });

  it("changePrice percent: درصدی روی قیمت فعلی", async () => {
    const before = Number((await svc.effectivePrice(SKU, "website")).price);
    const r = await svc.changePrice({
      skus: [SKU],
      levelCode: LEVEL,
      mode: "percent",
      amount: -10,
      source: "test",
    });
    expect(r.changed).toBe(1);
    const after = Number((await svc.effectivePrice(SKU, "website")).price);
    expect(after).toBe(Math.round(before * 0.9));
  });

  it("salePrice بیشتر از قیمت جدید رد می‌شود (SALE_PRICE_INVALID)", async () => {
    await expect(
      svc.changePrice({
        skus: [SKU],
        levelCode: LEVEL,
        mode: "absolute",
        amount: 100000,
        salePrice: 200000,
        source: "test",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("clearSale: فروش ویژه حذف می‌شود", async () => {
    // اول فروش ویژه بگذار
    await svc.changePrice({
      skus: [SKU], levelCode: LEVEL, mode: "absolute", amount: 500000,
      salePrice: 450000, source: "test",
    });
    const withSale = await svc.effectivePrice(SKU, "website");
    expect(withSale.salePrice).not.toBeNull();

    // بعد حذف کن
    await svc.changePrice({ skus: [SKU], levelCode: LEVEL, mode: "absolute", amount: 500000, clearSale: true, source: "test" });
    const cleared = await svc.effectivePrice(SKU, "website");
    expect(cleared.salePrice).toBeNull();
  });

  it("سطح نامعتبر رد می‌شود", async () => {
    await expect(
      svc.changePrice({ skus: [SKU], levelCode: "NOPE", mode: "absolute", amount: 1000, source: "test" }),
    ).rejects.toThrow(BadRequestException);
  });
});
