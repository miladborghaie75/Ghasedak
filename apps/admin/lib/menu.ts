/**
 * منوی ادمین — بند ۸: permission-aware؛ بدون مجوز، آیتم اصلاً رندر نمی‌شود
 * (اما امنیت واقعی سمت API است — این فقط لایهٔ رابط است).
 */

export interface MenuItem {
  title: string;
  href: string;
  permission?: string;
}

/**
 * یک زیربخش از یک گروه بزرگ‌تر (مثلاً «دفاتر» داخل «حسابداری»).
 *
 * چرا اضافه شد: کارهای مالی قبلاً در چهار گروه مختلف پخش بودند — انبار و خرید
 * زیر «فروشگاه»، صندوق و چک هم جای دیگر، بقیه زیر «حسابداری». برای پیدا
 * کردن یک کار مالی باید کل سایدبار را می‌گشتی.
 *
 * قاعده: اگر زیربخش فقط **یک** صفحه داشته باشد، سرِ تاشو نمی‌شود و مستقیم
 * لینک می‌شود — چون تاشو کردن یک آیتم تنها، فقط یک کلیک اضافه می‌کند.
 */
export interface MenuSection {
  title: string;
  /** آیتمِ مستقیم وقتی زیربخش تک‌صفحه‌ای است */
  href?: string;
  permission?: string;
  /** زیربخش‌های تاشو شونده */
  items?: MenuItem[];
}

export interface MenuGroup {
  title: string;
  items: Array<MenuItem | MenuSection>;
}

/** تشخیص آیتم تاشو شونده از لینک ساده — برای رندر امن */
export function isSection(item: MenuItem | MenuSection): item is MenuSection {
  return "items" in item;
}

export const MENU: MenuGroup[] = [
  {
    title: "اصلی",
    items: [
      { title: "داشبورد مدیریتی", href: "/", permission: "dashboard.view" },
      { title: "کارت‌های عملیاتی", href: "/dashboard", permission: "dashboard.view" },
    ],
  },

  {
    title: "فروشگاه",
    items: [
      { title: "محصولات", href: "/products", permission: "products.view" },
      { title: "ورود گروهی محصولات", href: "/products/import", permission: "products.view" },
      { title: "دسته‌ها", href: "/categories", permission: "categories.view" },
      { title: "برندها", href: "/brands", permission: "brands.view" },
      { title: "ویژگی‌ها", href: "/attributes", permission: "attributes.view" },
      { title: "رسانه", href: "/media", permission: "media.view" },
      { title: "قیمت‌گذاری کانالی", href: "/pricing", permission: "pricing.view" },
    ],
  },

  {
    title: "فروش",
    items: [
      { title: "سفارش‌های سایت", href: "/orders", permission: "orders.view" },
      { title: "نظرات مشتریان", href: "/reviews", permission: "reviews.moderate" },
      { title: "پرداخت‌ها", href: "/payments", permission: "payments.view" },
      { title: "مشتریان و سبد رهاشده", href: "/customers", permission: "customers.view" },
      { title: "ترمینال فروش (POS)", href: "/pos", permission: "pos.view" },
      { title: "فاکتورهای حضوری", href: "/pos/invoices", permission: "pos.view" },
    ],
  },

  /**
   * گروه واحد حسابداری — همهٔ کارهای مالی اینجا.
   *
   * دامنه (طبق تصمیم کاربر): حسابداری + انبار + خرید + خزانه + چک.
   * بیرون از این گروه ماند: محصولات، دسته‌ها، برندها، قیمت‌گذاری، رسانه،
   * سفارش‌ها و صندوق فروش — چون آن‌ها کار انبار یا دفتر نیستند، کار فروش‌اند.
   *
   * گروه «POS» حذف شد و دو آیتمش به گروه «فروش» رفتند.
   */
  {
    title: "حسابداری",
    items: [
      {
        title: "دفاتر",
        permission: "accounting.view",
        items: [
          { title: "اسناد حسابداری", href: "/accounting/journal", permission: "accounting.view" },
          { title: "سال مالی و تراز افتتاحیه", href: "/accounting/fiscal-year", permission: "accounting.view" },
          { title: "کدینگ حساب‌ها", href: "/accounting/chart", permission: "accounting.view" },
          { title: "گزارش‌های مالی", href: "/accounting", permission: "accounting.view" },
        ],
      },
      {
        title: "بانکداری",
        permission: "treasury.view",
        items: [{ title: "صندوق و بانک و چک", href: "/treasury", permission: "treasury.view" }],
      },
      {
        title: "انبارداری",
        permission: "inventory.view",
        items: [
          { title: "موجودی و انبارگردانی", href: "/inventory", permission: "inventory.view" },
          { title: "انبارها", href: "/inventory/warehouses", permission: "inventory.view" },
          { title: "گزارش موجودی", href: "/inventory/reports", permission: "inventory.reports" },
          { title: "چاپ برچسب بارکد", href: "/inventory/labels", permission: "products.view" },
        ],
      },
      {
        title: "خرید و هزینه",
        permission: "inventory.view",
        items: [{ title: "خرید از تامین‌کننده", href: "/inventory/purchase", permission: "inventory.view" }],
      },
      {
        title: "گزارش‌ها",
        permission: "accounting.reports",
        items: [
          { title: "گزارش‌های مدیریتی", href: "/reports", permission: "accounting.reports" },
          { title: "سود واقعی", href: "/reports/profit", permission: "accounting.reports" },
        ],
      },
      {
        title: "تسویه درگاه",
        permission: "payments.view",
        items: [
          { title: "تسویهٔ درگاه", href: "/settlements", permission: "payments.view" },
        ],
      },
    ],
  },

  {
    title: "بازاریابی",
    items: [
      { title: "کدهای تخفیف و گزارش فروش", href: "/marketing", permission: "marketing.view" },
      { title: "ویزارد «چی لازم داری؟»", href: "/need-finder", permission: "marketing.view" },
      { title: "صفحه‌ساز زنده", href: "/builder", permission: "marketing.view" },
    ],
  },

  {
    title: "سیستم",
    items: [
      { title: "کاربران", href: "/users", permission: "users.view" },
      { title: "Audit Log", href: "/audit", permission: "audit.view" },
      { title: "تنظیمات", href: "/settings", permission: "settings.view" },
      { title: "پیامک و درگاه پرداخت", href: "/settings/capabilities", permission: "settings.view" },
      { title: "وب‌سرویس", href: "/web-service", permission: "settings.view" },
      { title: "اعلان‌ها و صف ارسال", href: "/settings/notifications", permission: "settings.view" },
      { title: "پشتیبان‌گیری", href: "/settings/backup", permission: "settings.view" },
      { title: "ممیزی لحن", href: "/settings/tone-audit", permission: "settings.view" },
      { title: "مرکز عیب‌یابی", href: "/settings/diagnostics", permission: "settings.view" },
    ],
  },
];

/**
 * همهٔ مسیرهای منو — برای تست اینکه هیچ صفحه‌ای بدون لینک جا نمانده باشد.
 * عمداً صادر می‌شود تا تست بتواند آن را بخواند.
 */
export function allMenuHrefs(): string[] {
  const out: string[] = [];
  for (const g of MENU) {
    for (const it of g.items) {
      if (isSection(it)) {
        if (it.href) out.push(it.href);
        for (const leaf of it.items ?? []) out.push(leaf.href);
      } else {
        out.push(it.href);
      }
    }
  }
  return out;
}
