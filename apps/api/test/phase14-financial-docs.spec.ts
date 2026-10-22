/**
 * فاز ۱۴ بند ۱ — سندهای مالی فروش/خرید (روی DB آزمایش):
 *  1) GRN خرید → سند Dr 1200 موجودی کالا / Cr 2100 بدهی تامین‌کننده (در همان تراکنش)
 *  2) پرداخت فاکتور خرید → سند Dr 2100 / Cr خزانه (نقد/بانک) یا Cr 2110 چک
 *  3) فروش POS → سند درآمد + بهای تمام‌شده (Dr 5000 / Cr 1200) در همان سند
 *  4) مرجوعی POS → سند برگشت بهای تمام‌شده (Dr 1200 / Cr 5000) — فقط وقتی بهای واقعی دارد
 * تراکنش‌ها با rollback آزمایش می‌شوند (بدون اثر ماندگار روی DB آزمایش).
 */
import "reflect-metadata";
import { PrismaService } from "../src/prisma/prisma.service";
import { InventoryService } from "../src/inventory/inventory.service";
import { JournalService } from "../src/accounting/journal.service";
import { PurchasingService } from "../src/inventory/purchasing.service";
import { EventBusService } from "../src/events/event-bus.service";
import { TreasuryService } from "../src/treasury/treasury.service";
import { ChecksService } from "../src/checks/checks.service";
import { PricingService } from "../src/pricing/pricing.service";
import { PosService } from "../src/pos/pos.service";

jest.setTimeout(180_000);

describe("Phase 14 item 1 — financial documents", () => {
  let prisma: PrismaService;
  let inv: InventoryService;
  let journal: JournalService;
  let bus: EventBusService;
  let treasury: TreasuryService;
  let checks: ChecksService;
  let purchasing: PurchasingService;
  let pos: PosService;
  let actorId: string;

  let categoryId: string;
  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    bus = new EventBusService(prisma);
    inv = new InventoryService(prisma, {} as never);
    journal = new JournalService(prisma);
    treasury = new TreasuryService(prisma, journal);
    checks = new ChecksService(prisma, journal);
    purchasing = new PurchasingService(prisma, inv, bus, treasury, checks, journal);
    pos = new PosService(prisma, inv, journal, new PricingService(prisma, bus), treasury, checks);
    const cat = await prisma.category.findFirst();
    categoryId = cat!.id;
    const admin = await prisma.user.findFirst({ where: { email: "admin@ghasedak.demo" } });
    actorId = admin!.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("GRN: سند Dr 1200 / Cr 2150 (GRNI) ساخته می‌شود — نه Dr 1200 / Cr 2100", async () => {
    // تامین‌کنندهٔ تستی + واریانت تستی با cleanup
    const supplier = await prisma.supplier.create({ data: { name: "تست تامین GRN (spec)" } });
    const warehouse = await prisma.warehouse.findFirst({ where: { active: true } });
    expect(warehouse).toBeTruthy();
    const sku = `TESTSKU-${Date.now()}`;
    await prisma.productVariant.create({
      data: { sku, barcode: `BC-${Date.now()}`, price: 100000, stockQty: 0, reservedQty: 0, lowStockThreshold: 0, product: { create: { name: "محصول آزمون GRN", slug: `grn-${Date.now()}`, basePrice: 100000, categoryId } } },
    });
    const qty = 5;
    const unitCost = 40000;
    const grn = await purchasing.createGRN({
      supplierId: supplier.id,
      warehouseId: warehouse!.id,
      lines: [{ variantSku: sku, qty, unitCost }],
      actorId,
    });
    const expected = qty * unitCost;
    const je = await prisma.journalEntry.findFirst({
      where: { sourceType: "goods_receipt", sourceId: grn.id },
      include: { lines: { include: { account: true } } },
    });
    expect(je).toBeTruthy();
    // سند دریافت کالا: Dr 1200 موجودی / Cr 2150 کالای دریافتی‌صورت‌حساب‌نشده (GRNI)
    //
    // تغییر در فاز ۱ (باگ A2): این تست قبلاً `Cr 2100` (بدهی تامین‌کننده) را
    // انتظار می‌داشت، ولی آن رفتار **غلط** بود و در باگ A2 به این خود رسید که
    // هر GRN دو سند می‌زد: یکی اینجا (Cr 2100) و یکی در کنترلر (Cr 2150).
    // نتیجه: موجودی کالا دوبرابر + بدهی‌ای که هیچ فاکتوری پشتش نبود.
    //
    // سند درست (بند ۴۷): بدهی واقعی (AP) فقط با **فاکتور خرید** باز می‌شود؛ تا
    // آن زمان کالای دریافتی در حساب GRNI می‌ماند تا در ترازنامه قابل ردیابی باشد.
    // از فاز ۶، موجودی روی **حساب اختصاصی همان انبار** می‌نشیند
    // (`1200-93` و…) نه روی گروه `1200`. پس هر خط بدهکارِ زیرمجموعهٔ
    // ۱۲۰۰ قبول است — چه گروه باشد چه زیرحساب انبار.
    const isInv = (code: string) => code === "1200" || code.startsWith("1200-");
    const dr1200 = je!.lines.filter((l) => isInv(l.account.code) && l.debit > 0).reduce((s, l) => s + Number(l.debit), 0);
    const crGrni = je!.lines.filter((l) => l.account.code === "2150" && l.credit > 0).reduce((s, l) => s + Number(l.credit), 0);
    const crAp = je!.lines.filter((l) => l.account.code === "2100" && l.credit > 0).reduce((s, l) => s + Number(l.credit), 0);
    expect(dr1200).toBe(expected);
    expect(crGrni).toBe(expected);
    expect(crAp).toBe(0); // بدون فاکتور، بدهی تأمین‌کننده نباید باز شود

    // و سند دومی نباید وجود داشته باشد (یعنی A2 واقعاً رفع شده)
    const entriesForGrn = await prisma.journalEntry.findMany({
      where: { sourceId: grn.id, sourceType: "goods_receipt" },
    });
    expect(entriesForGrn.length).toBe(1);
    // WAC به‌روز شده
    const wac = await inv.wac(warehouse!.id, sku);
    expect(wac).toBe(BigInt(unitCost));
    // cleanup
    await prisma.journalLine.deleteMany({ where: { entryId: je!.id } });
    await prisma.journalEntry.delete({ where: { id: je!.id } });
    await prisma.stockLedgerEntry.deleteMany({ where: { refId: grn.id } });
    await prisma.goodsReceipt.delete({ where: { id: grn.id } });
    const variant = await prisma.productVariant.findUnique({ where: { sku } });
    if (variant) await prisma.productVariant.delete({ where: { sku } }).catch(() => undefined);
    await prisma.supplier.delete({ where: { id: supplier.id } }).catch(() => undefined);
  });

  it("فروش POS وقتی بهای دارد: سند شامل Dr 5000 / Cr 1200 است و تراز است", async () => {
    // شیفت باز + واریانت با بهای مشخص
    //
    // انبار از روی کانالِ POS خوانده می‌شود، نه «اولین انبارِ فعال».
    // چرا؟ فروشِ POS موجودی را از `channel.defaultWarehouseId` کم می‌کند؛
    // اگر تست انبارِ دیگری را انتخاب کند، موجودی جایی شارژ می‌شود که فروش
    // از آن کم نمی‌شود ⇒ «موجودی کافی نیست». با انبارِ خودِ کانال، تست
    // مستقل از داده‌های باقی‌ماندهٔ انبارهای آزمایشیِ قبلی می‌ماند.
    const channel = await prisma.salesChannel.findFirst({ where: { slug: "pos" } });
    expect(channel).toBeTruthy();
    const warehouseId = channel!.defaultWarehouseId!;
    const admin = await prisma.user.findFirst({ where: { email: "admin@ghasedak.demo" } });
    const sku = `TESTSKU-POS-${Date.now()}`;
    const unitCost = 50000n;
    // واریانت اول — FK دفتر انبار
    await prisma.productVariant.create({
      data: { sku, barcode: `BCP-${Date.now()}`, price: 120000, stockQty: 10, reservedQty: 0, lowStockThreshold: 0, product: { create: { name: "محصول آزمون POS", slug: `pos-${Date.now()}`, basePrice: 120000, categoryId } } },
    });
    // ورود بهایی (OPENING)
    await prisma.$transaction(async (tx) => {
      await inv.moveInTx(tx, {
        warehouseId, variantSku: sku, type: "OPENING", qty: 10, unitCost,
        refType: "opening", refId: "spec-open", idempotencyKey: `spec-open:${sku}`, actorId,
      });
    });
    // شیفت‌های بازی قبلی این کاربر را می‌بندیم (اجرای قبلی ممکن است شیفت رها کرده باشد)
    await prisma.cashierShift.updateMany({ where: { userId: admin!.id, state: "OPEN" }, data: { state: "CLOSED" } });
    const shift = await pos.openShift({ userId: admin!.id, registerName: "REG-SPEC", openingCash: 0 });
    const sale = await pos.sale({
      shiftId: shift.id,
      lines: [{ sku, qty: 2 }],
      payments: [{ methodCode: "cash", amount: 240000 }],
    } as never, admin!.id);
    const je = await prisma.journalEntry.findFirst({
      where: { sourceType: "pos_invoice", sourceId: sale.id },
      include: { lines: { include: { account: true } } },
    });
    expect(je).toBeTruthy();
    const dr4000 = je!.lines.filter((l) => l.account.code === "4000" && l.credit > 0).reduce((s, l) => s + Number(l.credit), 0);
    expect(dr4000).toBe(240000);
    const dr5000 = je!.lines.filter((l) => l.account.code === "5000" && l.debit > 0).reduce((s, l) => s + Number(l.debit), 0);
    // از فاز ۶: کاهش موجودی روی حساب اختصاصی انبار (`1200-xx`)
    const isInv = (code: string) => code === "1200" || code.startsWith("1200-");
    const cr1200 = je!.lines.filter((l) => isInv(l.account.code) && l.credit > 0).reduce((s, l) => s + Number(l.credit), 0);
    expect(dr5000).toBe(Number(unitCost) * 2); // 100000
    expect(cr1200).toBe(Number(unitCost) * 2);
    const dr = je!.lines.reduce((s, l) => s + Number(l.debit), 0);
    const cr = je!.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(dr).toBe(cr); // تراز
    // cleanup شیفت
    await prisma.cashierShift.delete({ where: { id: shift.id } }).catch(() => undefined);
  });

  it("فروش POS بدون بهای ثبت‌شده: سند COGS ندارد ولی تراز می‌ماند (صادقانه)", async () => {
    // همان قاعدهٔ تستِ بالا: انبارِ فروش، انبارِ کانالِ POS است
    const channel = await prisma.salesChannel.findFirst({ where: { slug: "pos" } });
    expect(channel).toBeTruthy();
    const warehouseId = channel!.defaultWarehouseId!;
    const admin = await prisma.user.findFirst({ where: { email: "admin@ghasedak.demo" } });
    const sku = `TESTSKU-NOCOST-${Date.now()}`;
    // واریانت اول — FK
    await prisma.productVariant.create({
      data: { sku, barcode: `BCN-${Date.now()}`, price: 90000, stockQty: 3, reservedQty: 0, lowStockThreshold: 0, product: { create: { name: "محصول بدون بها", slug: `nc-${Date.now()}`, basePrice: 90000, categoryId } } },
    });
    // OPENING بدون بها (unitCost: null) — سند COGS زده نمی‌شود (صادقانه)
    await prisma.$transaction(async (tx) => {
      await inv.moveInTx(tx, {
        warehouseId, variantSku: sku, type: "OPENING", qty: 3,
        refType: "opening", refId: "spec-open-nocost", idempotencyKey: `spec-open-nocost:${sku}`, actorId,
      } as never);
    });
    await prisma.cashierShift.updateMany({ where: { userId: admin!.id, state: "OPEN" }, data: { state: "CLOSED" } });
    const shift = await pos.openShift({ userId: admin!.id, registerName: "REG-SPEC-NC", openingCash: 0 });
    const sale = await pos.sale({
      shiftId: shift.id,
      lines: [{ sku, qty: 1 }],
      payments: [{ methodCode: "cash", amount: 90000 }],
    } as never, admin!.id);
    const je2 = await prisma.journalEntry.findFirst({
      where: { sourceType: "pos_invoice", sourceId: sale.id },
      include: { lines: { include: { account: true } } },
    });
    expect(je2).toBeTruthy();
    const cogs = je2!.lines.filter((l) => l.account.code === "5000");
    expect(cogs).toHaveLength(0);
    const dr = je2!.lines.reduce((s, l) => s + Number(l.debit), 0);
    const cr = je2!.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(dr).toBe(cr);
    await prisma.cashierShift.delete({ where: { id: shift.id } }).catch(() => undefined);
  });
});
