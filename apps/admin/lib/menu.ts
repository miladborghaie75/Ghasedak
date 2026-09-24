/** منوی ادمین — بند ۸: permission-aware؛ بدون مجوز، آیتم اصلاً رندر نمی‌شود (اما امنیت واقعی سمت API است) */
export interface MenuItem {
  title: string;
  href: string;
  permission?: string;
}

export interface MenuGroup {
  title: string;
  items: MenuItem[];
}

export const MENU: MenuGroup[] = [
  {
    title: "اصلی",
    items: [{ title: "داشبورد", href: "/", permission: "dashboard.view" }],
  },
  {
    title: "فروشگاه",
    items: [
      { title: "محصولات", href: "/products", permission: "products.view" },
      { title: "دسته‌ها", href: "/categories", permission: "categories.view" },
      { title: "برندها", href: "/brands", permission: "brands.view" },
      { title: "ویژگی‌ها", href: "/attributes", permission: "attributes.view" },
      { title: "موجودی و انبارگردانی", href: "/inventory", permission: "inventory.view" },
      { title: "انبارها", href: "/inventory/warehouses", permission: "inventory.view" },
      { title: "گزارش‌های انبار", href: "/inventory/reports", permission: "inventory.reports" },
      { title: "خرید از تامین‌کننده", href: "/inventory/purchase", permission: "inventory.view" },
      { title: "رسانه", href: "/media", permission: "media.view" },
    ],
  },
  {
    title: "POS",
    items: [
      { title: "ترمینال فروش", href: "/pos", permission: "pos.view" },
    ],
  },
  {
    title: "سفارش‌ها",
    items: [
      { title: "سفارش‌ها", href: "/orders", permission: "orders.view" },
      { title: "پرداخت‌ها", href: "/payments", permission: "payments.view" },
      { title: "مشتریان و سبد رهاشده", href: "/customers", permission: "customers.view" },
    ],
  },
  {
    title: "حسابداری",
    items: [
      { title: "حسابداری کامل", href: "/accounting", permission: "accounting.view" },
    ],
  },
  {
    title: "بازاریابی",
    items: [
      { title: "کدهای تخفیف و گزارش فروش", href: "/marketing", permission: "marketing.view" },
      { title: "صفحه‌ساز صفحه اصلی", href: "/homepage", permission: "marketing.view" },
    ],
  },
  {
    title: "سیستم",
    items: [
      { title: "کاربران", href: "/users", permission: "users.view" },
      { title: "Audit Log", href: "/audit", permission: "audit.view" },
      { title: "تنظیمات", href: "/settings", permission: "settings.view" },
      { title: "پیامک و درگاه پرداخت", href: "/settings/capabilities", permission: "settings.view" },
    ],
  },
];
