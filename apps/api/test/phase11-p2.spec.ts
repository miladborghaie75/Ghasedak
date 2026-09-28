/**
 * فاز ۱۱ — P2: Operational Usability
 * A) تیکت ماندگار POS: create → update → hold → resume → complete؛
 *    version conflict (optimistic locking)؛ invalid transition؛ list per user.
 */
import "reflect-metadata";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { JournalService } from "../src/accounting/journal.service";
import { TreasuryService } from "../src/treasury/treasury.service";
import { InventoryService } from "../src/inventory/inventory.service";
import { InventorySettingsService } from "../src/inventory/inventory-settings.service";
import { EventBusService } from "../src/events/event-bus.service";
import { PricingService } from "../src/pricing/pricing.service";
import { ChecksService } from "../src/checks/checks.service";
import { PosService } from "../src/pos/pos.service";

jest.setTimeout(120_000);

describe("Phase 11 — P2 (persistent POS tickets)", () => {
  let prisma: PrismaService;
  let pos: PosService;
  let inventory: InventoryService;
  let actor: string;
  let actor2: string;
  let fixtureSku: string;
  const tag = `p11t${Date.now()}${Math.floor(Math.random() * 100000)}`;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const journal = new JournalService(prisma);
    const treasury = new TreasuryService(prisma, journal);
    inventory = new InventoryService(prisma, new InventorySettingsService(prisma));
    const bus = new EventBusService(prisma);
    pos = new PosService(prisma, inventory, journal, new PricingService(prisma, bus), treasury, new ChecksService(prisma, journal));
    actor = (await prisma.user.findFirstOrThrow()).id;
    actor2 = (await prisma.user.findFirst({ where: { id: { not: actor } } }))?.id ?? actor;

    const cat = await prisma.category.findFirstOrThrow();
    const product = await prisma.product.create({
      data: {
        name: `محصول تیکت ${tag}`,
        slug: `p11-ticket-${tag}`,
        status: "PUBLISHED",
        categoryId: cat.id,
        basePrice: 100_000n,
        variants: { create: [{ sku: `P11-T-${tag}`, price: 100_000n }] },
      },
      include: { variants: true },
    });
    fixtureSku = product.variants[0].sku;
  });

  afterAll(async () => {
    await prisma.posTicket.deleteMany({ where: { OR: [{ userId: { in: [actor, actor2] }, audit: { path: ["0", "actorId"], equals: undefined } as never }, { id: { startsWith: "p11" } }] } }).catch(() => undefined);
    // پاک‌سازی دقیق با tag — audit snapshot شامل tag نیست؛ از items sku استفاده می‌کنیم
    const tickets = await prisma.posTicket.findMany({ where: { items: { path: ["0", "sku"], equals: fixtureSku } as never }, select: { id: true } });
    for (const t of tickets) await prisma.posTicket.delete({ where: { id: t.id } }).catch(() => undefined);
    const fv = await prisma.productVariant.findUnique({ where: { sku: fixtureSku }, select: { productId: true } });
    if (fv) {
      await prisma.productVariant.deleteMany({ where: { sku: fixtureSku } });
      await prisma.product.deleteMany({ where: { id: fv.productId } });
    }
    await prisma.$disconnect();
  });

  it("A1) create → update → hold → resume؛ version بعد از هر گذار increment می‌شود", async () => {
    const t = await pos.ticketCreate({ userId: actor, items: [{ sku: fixtureSku, qty: 1 }] });
    expect(t.status).toBe("OPEN");
    expect(t.version).toBe(1);

    const upd = await pos.ticketUpdate(t.id, { expectedVersion: 1, actorId: actor, items: [{ sku: fixtureSku, qty: 3 }], customerMobile: "09120000000" });
    expect(upd.version).toBe(2);
    expect((upd.items as Array<{ qty: number }>)[0].qty).toBe(3);

    const held = await pos.ticketTransition(t.id, { expectedVersion: 2, actorId: actor, to: "HELD" });
    expect(held.status).toBe("HELD");

    // list فقط OPEN/HELD این user را می‌دهد — refresh-safe
    const list = await pos.ticketList(actor);
    expect(list.some((x) => x.id === t.id)).toBe(true);

    const resumed = await pos.ticketTransition(t.id, { expectedVersion: 3, actorId: actor, to: "OPEN" });
    expect(resumed.status).toBe("OPEN");
    expect(resumed.version).toBe(4);

    const done = await pos.ticketComplete(t.id, { expectedVersion: 4, actorId: actor });
    expect(done.status).toBe("COMPLETED");

    // COMPLETED از list حذف می‌شود
    const list2 = await pos.ticketList(actor);
    expect(list2.some((x) => x.id === t.id)).toBe(false);
  });

  it("A2) optimistic locking: version کهنه ⇒ TICKET_VERSION_CONFLICT", async () => {
    const t = await pos.ticketCreate({ userId: actor, items: [] });
    await pos.ticketUpdate(t.id, { expectedVersion: 1, actorId: actor, items: [{ sku: fixtureSku, qty: 1 }] });
    // با version قدیمی (1) تلاش دوم باید conflict بدهد
    await expect(pos.ticketUpdate(t.id, { expectedVersion: 1, actorId: actor, items: [] })).rejects.toThrow(ConflictException);
    // دو transition همزمان با version یکسان — فقط یکی
    const t2 = await pos.ticketCreate({ userId: actor, items: [] });
    const [a, b] = await Promise.allSettled([
      pos.ticketTransition(t2.id, { expectedVersion: 1, actorId: actor, to: "HELD" }),
      pos.ticketTransition(t2.id, { expectedVersion: 1, actorId: actor2, to: "CANCELLED" }),
    ]);
    const ok = [a, b].filter((x) => x.status === "fulfilled");
    expect(ok).toHaveLength(1);
  });

  it("A3) invalid transitions و تیکت ناموجود", async () => {
    const t = await pos.ticketCreate({ userId: actor, items: [] });
    // OPEN → OPEN از طریق transition مجاز نیست (resume فقط از HELD)
    await expect(pos.ticketTransition(t.id, { expectedVersion: 1, actorId: actor, to: "OPEN" })).rejects.toThrow(BadRequestException);
    // cancel از OPEN مجاز است؛ بعدش terminal
    const c = await pos.ticketTransition(t.id, { expectedVersion: 1, actorId: actor, to: "CANCELLED" });
    expect(c.status).toBe("CANCELLED");
    await expect(pos.ticketTransition(c.id, { expectedVersion: c.version, actorId: actor, to: "OPEN" })).rejects.toThrow(BadRequestException);
    await expect(pos.ticketGet("does-not-exist")).rejects.toThrow(NotFoundException);
    // update روی CANCELLED مجاز نیست
    await expect(pos.ticketUpdate(c.id, { expectedVersion: c.version, actorId: actor, items: [] })).rejects.toThrow(BadRequestException);
  });
});
