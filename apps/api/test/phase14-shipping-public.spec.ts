/**
 * موج ۱ — روش‌های ارسال عمومی: فقط active، cost/freeOverAmount عددی،
 * ترتیب sortOrder. storefront برای ثبت سفارش به idهای واقعی همین اندپوینت
 * وابسته است (قبلاً «post»/«express» سخت‌کد بود و 400 می‌خورد).
 * روی rehearsal اجرا می‌شود؛ ردیف‌های خودش را می‌سازد و پاک می‌کند.
 */
import "reflect-metadata";
import { PrismaService } from "../src/prisma/prisma.service";
import { ShippingPublicController } from "../src/shipping/shipping-public.controller";

jest.setTimeout(120_000);

describe("Phase 14 wave1 — public shipping methods", () => {
  let prisma: PrismaService;
  let ctl: ShippingPublicController;
  let zoneId: string;
  const methodIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    ctl = new ShippingPublicController(prisma);
    const zone = await prisma.shippingZone.create({
      data: { name: `تست ارسال ${Date.now()}`, provinceIds: [] },
    });
    zoneId = zone.id;
  });

  afterAll(async () => {
    await prisma.shippingMethod.deleteMany({ where: { id: { in: methodIds } } }).catch(() => undefined);
    await prisma.shippingZone.delete({ where: { id: zoneId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  const makeMethod = async (opts: { tag: string; cost: bigint; freeOverAmount?: bigint | null; status?: string; sortOrder?: number }) => {
    const m = await prisma.shippingMethod.create({
      data: {
        zoneId,
        name: `پست تست ${opts.tag}`,
        cost: opts.cost,
        freeOverAmount: opts.freeOverAmount ?? null,
        status: opts.status ?? "active",
        sortOrder: opts.sortOrder ?? 0,
      },
    });
    methodIds.push(m.id);
    return m;
  };

  it("فقط active را می‌دهد و اعداد را عددی برمی‌گرداند", async () => {
    const active = await makeMethod({ tag: `a-${Date.now()}`, cost: 49_000n, freeOverAmount: 1_500_000n });
    await makeMethod({ tag: `i-${Date.now()}`, cost: 10_000n, status: "inactive" });

    const out = (await ctl.list()) as Array<{ id: string; cost: number; freeOverAmount: number | null }>;

    expect(out.map((m) => m.id)).toContain(active.id);
    const row = out.find((m) => m.id === active.id)!;
    expect(row.cost).toBe(49_000); // عدد، نه BigInt/رشته
    expect(row.freeOverAmount).toBe(1_500_000);
    // غیرفعال نباید در خروجی باشد
    const inactiveId = methodIds.find((id) => id !== active.id)!;
    expect(out.map((m) => m.id)).not.toContain(inactiveId);
  });

  it("freeOverAmount خالی null می‌آید و ترتیب sortOrder رعایت است", async () => {
    const first = await makeMethod({ tag: `f-${Date.now()}`, cost: 120_000n, freeOverAmount: null, sortOrder: 1 });
    const second = await makeMethod({ tag: `s-${Date.now()}`, cost: 80_000n, freeOverAmount: null, sortOrder: 2 });

    const out = (await ctl.list()) as Array<{ id: string; freeOverAmount: number | null }>;
    const i1 = out.findIndex((m) => m.id === first.id);
    const i2 = out.findIndex((m) => m.id === second.id);
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i2).toBeGreaterThan(i1);
    expect(out.find((m) => m.id === first.id)!.freeOverAmount).toBeNull();
  });
});
