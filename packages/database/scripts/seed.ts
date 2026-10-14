/**
 * Seed توسعه — بند ۹۶: حداقل داده DEV، صراحتاً DEMO.
 * هیچ اعتبار/مجوز/مالیات/بج واقعی‌ای جعل نمی‌شود.
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";
import { FULL_CHART_OF_ACCOUNTS, SUB_ACCOUNTS } from "@ghasedak/contracts";

/**
 * کپی کمینه از منطق رسمی InventoryService.moveInTx (apps/api/src/inventory/inventory.service.ts)
 * — seed به apps/api وابستگی ندارد (مرز پکیج‌ها)؛ اما قواعد Ledger باید یکسان بماند:
 * idempotency با کلید یکتا، تراز per-warehouse+sku از خود Ledger، projection از نتیجه ledger،
 * CostLayer WAC روی ورودی بهایی (بند ۳۲)، موجودی منفی ممنوع (بند ۹۱).
 */
const IN_TYPES = new Set(["PURCHASE", "SALE_RETURN", "TRANSFER_IN", "OPENING", "ADJUSTMENT"]);

/** نوع کلاینت تراکنش Prisma (همان PrismaTransaction در API) */
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

async function ledgerMove(
  tx: Tx,
  input: {
    warehouseId: string; variantSku: string; type: "OPENING"; qty: number;
    unitCost?: bigint | null; refType?: string; refId?: string;
    idempotencyKey: string; actorId?: string; note?: string;
  },
): Promise<{ id: string; balanceAfter: number }> {
  const existing = await tx.stockLedgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return { id: existing.id, balanceAfter: existing.balanceAfter };

  await tx.$queryRaw`SELECT "sku" FROM "ProductVariant" WHERE "sku" = ${input.variantSku} FOR UPDATE`;
  const agg = await tx.stockLedgerEntry.aggregate({
    where: { warehouseId: input.warehouseId, variantSku: input.variantSku },
    _sum: { qtyIn: true, qtyOut: true },
  });
  const balanceBefore = (agg._sum.qtyIn ?? 0) - (agg._sum.qtyOut ?? 0);
  const balanceAfter = balanceBefore + input.qty; // OPENING همیشه IN است
  if (balanceAfter < 0) {
    throw new Error(`INSUFFICIENT_STOCK: ${input.variantSku}`);
  }
  const entry = await tx.stockLedgerEntry.create({
    data: {
      warehouseId: input.warehouseId,
      variantSku: input.variantSku,
      type: input.type,
      qtyIn: input.qty,
      qtyOut: 0,
      balanceBefore,
      balanceAfter,
      unitCost: input.unitCost ?? null,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      idempotencyKey: input.idempotencyKey,
      actorId: input.actorId ?? null,
      note: input.note ?? null,
    },
  });
  const variant = await tx.productVariant.findUnique({ where: { sku: input.variantSku } });
  if (!variant) throw new Error(`VARIANT_NOT_FOUND: ${input.variantSku}`);
  await tx.productVariant.update({
    where: { sku: input.variantSku },
    data: { stockQty: variant.stockQty + input.qty },
  });
  // CostLayer WAC — همان قاعدهٔ InventoryService (بند ۳۲)
  if (input.unitCost != null) {
    const layer = await tx.costLayer.findUnique({
      where: { warehouseId_variantSku: { warehouseId: input.warehouseId, variantSku: input.variantSku } },
    });
    if (!layer) {
      await tx.costLayer.create({
        data: {
          warehouseId: input.warehouseId, variantSku: input.variantSku,
          quantity: input.qty, avgUnitCost: input.unitCost,
        },
      });
    } else {
      const totalQty = layer.quantity + input.qty;
      const avg =
        totalQty > 0
          ? (layer.avgUnitCost * BigInt(layer.quantity) + input.unitCost * BigInt(input.qty)) / BigInt(totalQty)
          : input.unitCost;
      await tx.costLayer.update({
        where: { warehouseId_variantSku: { warehouseId: input.warehouseId, variantSku: input.variantSku } },
        data: { quantity: totalQty, avgUnitCost: avg },
      });
    }
  }
  return { id: entry.id, balanceAfter };
}

const prisma = new PrismaClient();

/** argon2id نیست — هش dev با scrypt (پارامترهای کم)؛ در API از argon2id استفاده می‌شود.
 *  برای seed dev این کافی و صراحتاً DEMO است. */
function devHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 }).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

const PERMISSIONS = [
  "dashboard.view",
  "products.view", "products.create", "products.update", "products.delete",
  "categories.view", "categories.manage",
  "brands.view", "brands.manage",
  "attributes.view", "attributes.manage",
  "inventory.view", "inventory.adjust", "inventory.stocktake",
  "inventory.manage", "inventory.transfer", "inventory.quarantine", "inventory.damage",
  "inventory.approve", "inventory.settings", "inventory.reports",
  "purchasing.view", "purchasing.manage", "purchasing.pay",
  "orders.view", "orders.update",
  "pricing.view", "pricing.manage",
  "customers.view", "customers.manage",
  "payments.view", "payments.verify", "payments.manage",
  "payments.reconcile", // بند ۱۸ Audit فاز ۹: عدم‌تقارن قبل — در ROLE_SETS بود ولی در PERMISSIONS نبود
  "checks.view", "checks.manage", "checks.clear", "checks.cancel", "checks.reconcile", // فاز ۹
  "returns.manage", "orders.refund", // فاز ۱۱ P1-B: endpointهای مرجوعی/بازگشت بدون permission بودند
  "pos.view", "pos.sell",
  "treasury.view", "treasury.manage",
  "accounting.view", "accounting.journal", "accounting.accounts", "accounting.reports",
  "reports.view",
  "media.view", "media.manage",
  "marketing.view", "marketing.manage",
  "settings.view", "settings.manage",
  "users.view", "users.manage",
  "roles.view", "roles.manage",
  "audit.view",
  "trust.view", "trust.manage",
  "system.health",
];

const ROLE_SETS: Record<string, string[]> = {
  SUPER_ADMIN: PERMISSIONS,
  ACCOUNTANT: [
    "dashboard.view",
    "payments.view", "payments.verify", "payments.reconcile" as string,
    "returns.manage", "orders.refund" as string, // فاز ۱۱ P1-B
    "accounting.view", "accounting.journal", "accounting.accounts", "accounting.reports",
    "treasury.view", "treasury.manage",
    // فاز ۹ Wave 2: دامنهٔ چک — دسترسی کامل حسابدار (هم‌راستا با خزانه)
    "checks.view", "checks.manage", "checks.clear", "checks.cancel", "checks.reconcile" as string,
    "purchasing.view", "purchasing.pay",
    "reports.view", "audit.view", "system.health",
  ],
  CASHIER: ["dashboard.view", "pos.view", "pos.sell", "products.view", "orders.view", "customers.view"],
  INVENTORY_MANAGER: [
    "dashboard.view", "products.view", "inventory.view", "inventory.adjust", "inventory.stocktake",
    "inventory.manage", "inventory.transfer", "inventory.quarantine", "inventory.damage",
    "inventory.settings", "inventory.reports",
    "purchasing.view", "purchasing.manage",
    "reports.view", "media.view",
  ],
};

async function main(): Promise<void> {
  console.log("== SEED (DEMO/DEV) ==");

  // ---- Permissions + RolePermissions
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  }
  for (const [role, perms] of Object.entries(ROLE_SETS)) {
    for (const p of perms) {
      await prisma.rolePermission.upsert({
        where: { role_permissionKey: { role: role as never, permissionKey: p } },
        update: {},
        create: { role: role as never, permissionKey: p },
      });
    }
  }

  // ---- کاربران ادمین DEMO
  const users: Array<{ role: keyof typeof ROLE_SETS; name: string; email: string }> = [
    { role: "SUPER_ADMIN", name: "مدیر ارشد (DEMO)", email: "admin@ghasedak.demo" },
    { role: "ACCOUNTANT", name: "حسابدار (DEMO)", email: "accountant@ghasedak.demo" },
    { role: "CASHIER", name: "صندوقدار (DEMO)", email: "cashier@ghasedak.demo" },
    { role: "INVENTORY_MANAGER", name: "انباردار (DEMO)", email: "inventory@ghasedak.demo" },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        name: u.name,
        role: u.role as never,
        passwordHash: devHash("Ghasedak#Demo1"),
      },
    });
  }

  // ---- انبار اصلی + کانال‌ها + سطوح قیمت (بند ۱۳/۱۱ Master)
  const wh = await prisma.warehouse.upsert({
    where: { code: "MAIN" },
    update: {},
    create: { code: "MAIN", name: "انبار اصلی (DEMO)", type: "main", priority: 10 },
  });

  // ---- روش‌های ارسال DEMO (بند ۳۰: هزینه + قاعده رایگان) — idempotent
  {
    // ShippingZone کلید یکتا روی name ندارد؛ create().catch() در اجرای دوم duplicate می‌سازد
    // (catch فقط خطای unique را می‌گیرد و اینجا constraintی وجود ندارد). lookup صریح به‌جای exception:
    const zone =
      (await prisma.shippingZone.findFirst({ where: { name: "تهران و سراسر کشور (DEMO)" } })) ??
      (await prisma.shippingZone.create({
        data: { name: "تهران و سراسر کشور (DEMO)", provinceIds: [], status: "active" },
      }));
    const ship = [
      { name: "پست پیشتاز (۳ تا ۵ روز کاری)", cost: 49000, eta: "۳ تا ۵ روز کاری", free: 1500000, sort: 1 },
      { name: "پیک اکسپرس تهران (همان روز)", cost: 120000, eta: "همان روز", free: null, sort: 2 },
    ];
    for (const s of ship) {
      const existing = await prisma.shippingMethod.findFirst({ where: { name: s.name } });
      if (!existing) {
        await prisma.shippingMethod.create({
          data: {
            zoneId: zone.id, name: s.name, cost: BigInt(s.cost),
            freeOverAmount: s.free == null ? null : BigInt(s.free),
            etaText: s.eta, sortOrder: s.sort, status: "active",
          },
        });
      }
    }
  }

  const levels: Array<{ code: string; name: string; sortOrder: number }> = [
    { code: "BASE", name: "قیمت پایه کالا", sortOrder: 0 },
    { code: "POS", name: "فروش حضوری", sortOrder: 1 },
    { code: "WEB", name: "فروشگاه اینترنتی", sortOrder: 2 },
    { code: "TOROB", name: "ترب", sortOrder: 3 },
    { code: "SNAPP", name: "اسنپ‌پی", sortOrder: 4 },
    { code: "OTHER", name: "سایر", sortOrder: 5 },
  ];
  const levelIds: Record<string, string> = {};
  for (const l of levels) {
    const pl = await prisma.priceLevel.upsert({
      where: { code: l.code }, update: {}, create: l,
    });
    levelIds[l.code] = pl.id;
  }

  const channels: Array<{ slug: string; name: string; type: string; level: string }> = [
    { slug: "pos", name: "فروش حضوری", type: "pos", level: "POS" },
    { slug: "website", name: "فروشگاه اینترنتی", type: "online", level: "WEB" },
    { slug: "torob", name: "ترب", type: "marketplace", level: "TOROB" },
    { slug: "snapp-pay", name: "اسنپ‌پی", type: "marketplace", level: "SNAPP" },
    { slug: "other", name: "سایر کانال", type: "other", level: "OTHER" },
  ];
  for (const c of channels) {
    const existing = await prisma.salesChannel.findUnique({ where: { slug: c.slug } });
    if (!existing) {
      await prisma.salesChannel.create({
        data: {
          slug: c.slug, name: c.name, type: c.type,
          priceLevelId: levelIds[c.level], defaultWarehouseId: wh.id,
          paymentMethodIds: [],
        },
      });
    }
  }

  // ---- روش‌های پرداخت (فعال: آنلاین/نقد/کارت؛ اقساطی غیرفعال بند ۱۶)
  const methods: Array<{ code: string; nameInternal: string; namePublic: string; active: boolean; sortOrder: number }> = [
    { code: "online", nameInternal: "درگاه آنلاین", namePublic: "پرداخت آنلاین", active: true, sortOrder: 1 },
    { code: "card_to_card", nameInternal: "کارت به کارت", namePublic: "کارت به کارت", active: true, sortOrder: 2 },
    { code: "pos_terminal", nameInternal: "کارتخوان", namePublic: "کارتخوان", active: true, sortOrder: 3 },
    { code: "cash", nameInternal: "نقدی", namePublic: "نقدی", active: true, sortOrder: 4 },
    { code: "installment", nameInternal: "اقساطی", namePublic: "پرداخت اقساطی", active: false, sortOrder: 5 },
  ];
  for (const m of methods) {
    await prisma.paymentMethod.upsert({ where: { code: m.code }, update: {}, create: m });
  }

  // ---- Provider آنلاین: زرین‌پال (بدون credential — بند ۱۱۱: ساختگی ممنوع)
  await prisma.paymentProvider.upsert({
    where: { id: "seed-zarinpal" },
    update: {},
    create: {
      id: "seed-zarinpal", provider: "zarinpal", name: "زرین‌پال (نیازمند مرچنت واقعی)",
      env: "sandbox", active: false, priority: 1,
      credentialsEncrypted: null,
    },
  }).catch(() => {
    // قبلاً با id متفاوت موجود است — بی‌اهمیت برای seed
  });

  // ---- مالیات: نرخ صفر پیش‌فرض (تصمیم تاییدشده)
  await prisma.taxRate.upsert({
    where: { code: "ZERO" },
    update: {},
    create: { code: "ZERO", name: "بدون مالیات (پیش‌فرض V1)", rate: 0 },
  });

  // ---- دسته‌ها + برند DEMO + اتریبیوت‌های پایه
  const cats: Array<{ slug: string; name: string }> = [
    { slug: "bra", name: "سوتین" },
    { slug: "panty", name: "شورت" },
    { slug: "set", name: "ست لباس زیر" },
    { slug: "shapewear", name: "گن" },
    { slug: "sport", name: "ورزشی" },
    { slug: "sleepwear", name: "لباس خواب" },
  ];
  const catIds: Record<string, string> = {};
  for (const c of cats) {
    const cat = await prisma.category.upsert({ where: { slug: c.slug }, update: {}, create: c });
    catIds[c.slug] = cat.id;
  }

  const brand = await prisma.brand.upsert({
    where: { slug: "ghasedak-demo" },
    update: {},
    create: { slug: "ghasedak-demo", name: "قاصدک (DEMO)" },
  });

  const attrDefs: Array<{ slug: string; name: string; terms: string[]; isVariantAxis: boolean }> = [
    { slug: "color", name: "رنگ", isVariantAxis: true, terms: ["مشکی", "سفید", "یاسی"] },
    { slug: "size", name: "سایز", isVariantAxis: true, terms: ["75", "80", "85", "S", "M", "L"] },
    { slug: "cup", name: "کاپ", isVariantAxis: true, terms: ["B", "C"] },
    { slug: "underwire", name: "فنر", isVariantAxis: false, terms: ["فنردار", "بدون فنر"] },
    { slug: "padding", name: "اسفنج", isVariantAxis: false, terms: ["اسفنج‌دار", "بدون اسفنج"] },
    { slug: "material", name: "جنس", isVariantAxis: false, terms: ["پنبه", "میکروفایبر"] },
  ];
  const termIds: Record<string, string> = {};
  for (const a of attrDefs) {
    const attr = await prisma.attribute.upsert({
      where: { slug: a.slug },
      update: {},
      create: {
        slug: a.slug, name: a.name, type: "SELECT", isVariantAxis: a.isVariantAxis,
        isFilterable: true, showOnProduct: true,
      },
    });
    for (const [i, t] of a.terms.entries()) {
      const term = await prisma.attributeTerm.upsert({
        where: { attributeId_slug: { attributeId: attr.id, slug: t } },
        update: {},
        create: { attributeId: attr.id, slug: t, value: t, sortOrder: i },
      });
      termIds[`${a.slug}:${t}`] = term.id;
    }
  }
  // hex رنگ‌ها
  const colorHex: Record<string, string> = { "مشکی": "#1F1A22", "سفید": "#FFFFFF", "یاسی": "#A67DEA" };
  for (const [slug, hex] of Object.entries(colorHex)) {
    await prisma.attributeTerm.update({
      where: { attributeId_slug: { attributeId: (await prisma.attribute.findUniqueOrThrow({ where: { slug: "color" } })).id, slug } },
      data: { hex },
    });
  }

  // ---- محصول DEMO ساده با دو واریانت (بدون فروش/نظر جعلی)
  const demoSlug = "sootin-classic-demo";
  const existing = await prisma.product.findUnique({ where: { slug: demoSlug } });
  if (!existing) {
    const product = await prisma.product.create({
      data: {
        name: "سوتین کلاسیک (DEMO)",
        slug: demoSlug,
        shortDescription: "محصول نمونه برای تست مسیر خرید — داده DEMO است.",
        status: "PUBLISHED",
        categoryId: catIds["bra"],
        brandId: brand.id,
        basePrice: 749_000n,
        publishedAt: new Date(),
      variants: {
        create: [
          {
            sku: "DEMO-BRA-75B-BLK",
            price: 749_000n,
            stockQty: 0, // موجودی واقعی از Ledger OPENING می‌آید (بند ۱۳۵)
          },
          {
            sku: "DEMO-BRA-80B-BLK",
            price: 749_000n,
            stockQty: 0, // موجودی واقعی از Ledger OPENING می‌آید (بند ۱۳۵)
          },
        ],
      },
      },
      include: { variants: true },
    });
    const web = await prisma.salesChannel.findUniqueOrThrow({ where: { slug: "website" } });
    for (const [vi, v] of product.variants.entries()) {
      await prisma.variantPrice.create({
        data: { variantSku: v.sku, priceLevelId: levelIds["WEB"], price: 749_000n },
      });
      await prisma.variantBarcode.create({
        data: { variantSku: v.sku, barcode: `626DEMO${String(vi + 1).padStart(5, "0")}`, kind: "internal" },
      });
    }

    // ---- موجودی اولیه از مسیر رسمی Ledger (بند ۱۲/۱۳۵) — نه UPDATE مستقیم stockQty.
    // ledgerMove همان منطق InventoryService.moveInTx است: StockLedgerEntry + projection + CostLayer،
    // idempotent با کلید `seed:opening:{sku}`؛ اجرای دوم seed دوباره اضافه نمی‌کند.
    // توجه: تست‌های wave3 به موجودی واقعی (ledger) وابسته‌اند — projection تنها کافی نیست.
    // actorId باید FK معتبر به User داشته باشد — از ادمین DEMO
    const seedActor = await prisma.user.findUniqueOrThrow({ where: { email: "admin@ghasedak.demo" }, select: { id: true } });
    for (const [vi, v] of product.variants.entries()) {
      await ledgerMove(prisma, {
        warehouseId: wh.id,
        variantSku: v.sku,
        type: "OPENING",
        qty: [5, 3][vi],
        unitCost: 300_000n,
        refType: "opening",
        refId: "seed",
        idempotencyKey: `seed:opening:${v.sku}`,
        actorId: seedActor.id,
        note: "موجودی اولیه DEMO از مسیر رسمی Ledger",
      });
    }
    void web;
  }

  // ---- فاکتور نمونه حسابداری: Chart of Accounts حداقلی + سال مالی
  // FiscalYear کلید یکتا روی title ندارد؛ create().catch(() => null) در اجرای دوم duplicate می‌سازد.
  // lookup صریح با کلید پایدار (title) به‌جای exception:
  let fy = await prisma.fiscalYear.findFirst({ where: { title: "۱۴۰۵ (DEMO)" } });
  if (!fy) {
    fy = await prisma.fiscalYear.create({
      data: { title: "۱۴۰۵ (DEMO)", startsAt: new Date("2026-03-21"), endsAt: new Date("2027-03-20") },
    });
  }
if (fy) {
    // Chart of Accounts از منبع واحد می‌آید (packages/contracts/account-codes)
    // تا نام و نوع حساب‌ها در یک جا تعریف شوند و با سندهای سرویس‌ها ناسازگار نشوند.
    // اول گروه‌های سطح ۱، بعد زیرحساب‌ها با اشاره به والد.
    for (const a of FULL_CHART_OF_ACCOUNTS.filter((x) => x.level === 1)) {
      await prisma.account.upsert({
        where: { code: a.code },
        update: {},
        create: {
          code: a.code,
          name: a.name,
          type: a.type as never,
          level: 1,
          parentAccountId: null,
        },
      });
    }
    for (const s of SUB_ACCOUNTS) {
      const parent = await prisma.account.findUnique({ where: { code: s.parent } });
      if (!parent) continue; // والد باید در گام قبل ساخته شده باشد
      await prisma.account.upsert({
        where: { code: s.code },
        update: { name: s.name, type: s.type as never, level: 2, parentAccountId: parent.id },
        create: {
          code: s.code,
          name: s.name,
          type: s.type as never,
          level: 2,
          parentAccountId: parent.id,
        },
      });
    }
  }

    // ---- خزانه DEMO (فاز ۸، بند ۵۹–۶۲): یک صندوق نقد + یک حساب بانکی روی حساب‌های GL
    // مانده جاری = مانده دفتری GL (projection صادقانه؛ بند ۱۰۷: بدون محاسبه موازی)
    const glCash = await prisma.account.findUnique({ where: { code: "1000" } });
    const glBank = await prisma.account.findUnique({ where: { code: "1100" } });
    if (glCash && glBank) {
      const book = async (glId: string) => {
        const agg = await prisma.journalLine.aggregate({ where: { accountId: glId }, _sum: { debit: true, credit: true } });
        return (agg._sum.debit ?? 0n) - (agg._sum.credit ?? 0n);
      };
      await prisma.cashAccount.upsert({
        where: { id: "demo-cash-main" },
        update: { currentBalance: await book(glCash.id), openingBalance: await book(glCash.id) },
        create: { id: "demo-cash-main", name: "صندوق فروشگاه (DEMO)", kind: "cash", glAccountId: glCash.id, openingBalance: await book(glCash.id), currentBalance: await book(glCash.id), active: true },
      });
      await prisma.bankAccount.upsert({
        where: { id: "demo-bank-main" },
        update: { currentBalance: await book(glBank.id), openingBalance: await book(glBank.id) },
        create: {
          id: "demo-bank-main",
          name: "حساب جاری اصلی (DEMO)",
          bankName: "بانک (DEMO)",
          accountNumber: "0000000000",
          iban: null,
          glAccountId: glBank.id,
          openingBalance: await book(glBank.id),
          currentBalance: await book(glBank.id),
          active: true,
        },
      });
    }

  // ---- Feature Flags (بند ۸۱) — همه خاموش؛ فعال‌سازی از ادمین
  for (const f of [
    { key: "ai_assistant", note: "دستیار هوشمند محصول" },
    { key: "loyalty", note: "باشگاه مشتریان" },
    { key: "card_to_card", note: "کارت به کارت (روش پرداخت فعال است، فلگ برای خاموشی اضطراری)" },
    { key: "marketplace_sync", note: "همگام‌سازی مارکت‌پلیس‌ها" },
    { key: "instagram_channel", note: "کانال اینستاگرام" },
  ]) {
    await prisma.featureFlag.upsert({ where: { key: f.key }, update: {}, create: { ...f, enabled: false } });
  }

  console.log("== SEED COMPLETE (همه داده‌ها DEMO/DEV) ==");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
