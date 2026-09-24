/**
 * Seed توسعه — بند ۹۶: حداقل داده DEV، صراحتاً DEMO.
 * هیچ اعتبار/مجوز/مالیات/بج واقعی‌ای جعل نمی‌شود.
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

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
  "customers.view", "customers.manage",
  "payments.view", "payments.verify",
  "pos.view", "pos.sell",
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
    "accounting.view", "accounting.journal", "accounting.accounts", "accounting.reports",
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
    const zone = await prisma.shippingZone.create({
      data: { name: "تهران و سراسر کشور (DEMO)", provinceIds: [], status: "active" },
    }).catch(async () => await prisma.shippingZone.findFirstOrThrow({ where: { name: { contains: "DEMO" } } }));
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
              stockQty: 5,
            },
            {
              sku: "DEMO-BRA-80B-BLK",
              price: 749_000n,
              stockQty: 3,
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
    void web;
  }

  // ---- فاکتور نمونه حسابداری: Chart of Accounts حداقلی + سال مالی
  const fy = await prisma.fiscalYear.create({
    data: { title: "۱۴۰۵ (DEMO)", startsAt: new Date("2026-03-21"), endsAt: new Date("2027-03-20") },
  }).catch(() => null);
  if (fy) {
    const accounts: Array<{ code: string; name: string; type: string }> = [
      { code: "1000", name: "موجودی نقد", type: "ASSET" },
      { code: "1100", name: "بانک", type: "ASSET" },
      { code: "1200", name: "موجودی کالا", type: "ASSET" },
      { code: "2100", name: "حساب‌های پرداختنی", type: "LIABILITY" },
      { code: "3000", name: "سرمایه", type: "EQUITY" },
      { code: "4000", name: "فروش", type: "REVENUE" },
      { code: "5000", name: "بهای تمام‌شده کالای فروش‌رفته", type: "COGS" },
      { code: "6000", name: "هزینه‌های عملیاتی", type: "EXPENSE" },
    ];
    for (const a of accounts) {
      await prisma.account.upsert({ where: { code: a.code }, update: {}, create: a });
    }
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
