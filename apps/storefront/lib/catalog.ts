/**
 * مدل محصول v2 — هم‌راستا با بند ۴۰ spec.
 * واریانت: ماتریس optionIds + موجودی. هیچ داده فروش/تخفیف/نظر جعلی وجود ندارد.
 * برچسب‌های «جدید» فقط از createdAt مشتق می‌شود (بند ۲۵).
 * DEMO: createdAtها نسبت به امروز نمایشی‌اند و صریحاً دمو هستند.
 */
import type { CategorySlug } from "./attributes";

export interface ProductV2 {
  id: string;
  slug: string;
  name: string;
  category: CategorySlug;
  brandId: string;
  /** توضیح کوتاه محصول */
  short: string;
  /** شناسه‌های اتریبیوت سطح محصول (جنس، …) */
  attributeIds: string[];
  variants: VariantV2[];
  /** تاریخ ایجاد نمایشی (ISO) — مبنای بج «جدید» */
  createdAt: string;
}

export interface VariantV2 {
  id: string;
  sku: string;
  price: number;
  /** تخفیف فقط وقتی واقعی — در دمو صفر مورد فعال است */
  salePrice?: number;
  stock: number;
  colorId: string;
  sizeId: string;
  /** فنر/اسفنج/کاپ برای دسته‌های دارای این بعد */
  optionIds: string[];
}

/** برندها — موجودیت مستقل (بند ۲۲) */
export interface BrandV2 {
  id: string;
  slug: string;
  name: string;
}

export const BRANDS_V2: BrandV2[] = [
  { id: "br-paniz", slug: "paniz", name: "پانیذ" },
  { id: "br-laya", slug: "laya", name: "لعیا" },
  { id: "br-golestan", slug: "golestan", name: "گلستان" },
  { id: "br-limon", slug: "limon", name: "لیمون" },
];

const DAY = 86_400_000;
const now = Date.now();
/** دمو: ۴ محصول اخیر برای «جدیدترین‌ها» — از createdAt مشتق، نه بج جعلی */
const iso = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString();

export const PRODUCTS_V2: ProductV2[] = [
  {
    id: "gp1",
    slug: "paniz-daily-cotton-bra",
    name: "سوتین نخی روزمره پانیذ",
    category: "bra",
    brandId: "br-paniz",
    short: "نخ پنبه‌ای تنفس‌پذیر برای استفاده روزمره",
    attributeIds: ["mt-cotton"],
    createdAt: iso(40),
    variants: [
      // مشکی: 75 و 80 — سفید: فقط 75 (بند ۱۲: انتخاب سفید باید 80 را غیرفعال کند)
      { id: "gv1", sku: "PNZ-BLK-75", price: 389000, stock: 8, colorId: "cl-black", sizeId: "sz-75", optionIds: ["uw-no", "pd-yes"] },
      { id: "gv2", sku: "PNZ-BLK-80", price: 389000, stock: 5, colorId: "cl-black", sizeId: "sz-80", optionIds: ["uw-no", "pd-yes"] },
      { id: "gv3", sku: "PNZ-WHT-75", price: 389000, stock: 3, colorId: "cl-white", sizeId: "sz-75", optionIds: ["uw-no", "pd-yes"] },
    ],
  },
  {
    id: "gp2",
    slug: "laya-underwire-bra",
    name: "سوتین فنردار لعیا",
    category: "bra",
    brandId: "br-laya",
    short: "فرم‌دهی ملایم با فنر نرم",
    attributeIds: ["mt-microfiber"],
    createdAt: iso(12),
    variants: [
      { id: "gv4", sku: "LYA-VLT-75", price: 479000, stock: 6, colorId: "cl-violet", sizeId: "sz-75", optionIds: ["uw-yes", "pd-yes", "cup-B"] },
      { id: "gv5", sku: "LYA-VLT-80", price: 479000, stock: 4, colorId: "cl-violet", sizeId: "sz-80", optionIds: ["uw-yes", "pd-yes", "cup-B"] },
      { id: "gv6", sku: "LYA-VLT-85", price: 499000, stock: 2, colorId: "cl-violet", sizeId: "sz-85", optionIds: ["uw-yes", "pd-yes", "cup-C"] },
      { id: "gv7", sku: "LYA-ROS-80", price: 479000, stock: 0, colorId: "cl-rose", sizeId: "sz-80", optionIds: ["uw-yes", "pd-yes", "cup-B"] },
      { id: "gv8", sku: "LYA-ROS-85", price: 479000, stock: 3, colorId: "cl-rose", sizeId: "sz-85", optionIds: ["uw-yes", "pd-yes", "cup-B"] },
    ],
  },
  {
    id: "gp3",
    slug: "laya-sport-set",
    name: "ست ورزشی لعیا",
    category: "sport",
    brandId: "br-laya",
    short: "پشتیبانی مناسب در حرکت با پارچه رطوبت‌کش",
    attributeIds: ["mt-microfiber"],
    createdAt: iso(3),
    variants: [
      { id: "gv9", sku: "LYA-SPT-M", price: 549000, stock: 7, colorId: "cl-black", sizeId: "sz-M", optionIds: [] },
      { id: "gv10", sku: "LYA-SPT-L", price: 549000, stock: 5, colorId: "cl-black", sizeId: "sz-L", optionIds: [] },
      { id: "gv11", sku: "LYA-SPT-SG-M", price: 549000, stock: 4, colorId: "cl-sage", sizeId: "sz-M", optionIds: [] },
    ],
  },
  {
    id: "gp4",
    slug: "golestan-seamless-panty",
    name: "شورت بدون درز گلستان",
    category: "panty",
    brandId: "br-golestan",
    short: "میکروفایبر لطیف، بدون خط زیر لباس",
    attributeIds: ["mt-microfiber"],
    createdAt: iso(60),
    variants: [
      { id: "gv12", sku: "GLS-CRM-S", price: 189000, stock: 15, colorId: "cl-cream", sizeId: "sz-S", optionIds: [] },
      { id: "gv13", sku: "GLS-CRM-M", price: 189000, stock: 12, colorId: "cl-cream", sizeId: "sz-M", optionIds: [] },
      { id: "gv14", sku: "GLS-CRM-L", price: 199000, stock: 8, colorId: "cl-cream", sizeId: "sz-L", optionIds: [] },
      { id: "gv15", sku: "GLS-BLK-L", price: 199000, stock: 6, colorId: "cl-black", sizeId: "sz-L", optionIds: [] },
    ],
  },
  {
    id: "gp5",
    slug: "golestan-cotton-panty",
    name: "شورت نخی گلستان",
    category: "panty",
    brandId: "br-golestan",
    short: "پنبه ۱۰۰٪ برای پوست‌های حساس",
    attributeIds: ["mt-cotton"],
    createdAt: iso(80),
    variants: [
      { id: "gv16", sku: "GLS2-WHT-M", price: 159000, stock: 20, colorId: "cl-white", sizeId: "sz-M", optionIds: [] },
      { id: "gv17", sku: "GLS2-WHT-L", price: 159000, stock: 0, colorId: "cl-white", sizeId: "sz-L", optionIds: [] },
      { id: "gv18", sku: "GLS2-VLT-L", price: 159000, stock: 9, colorId: "cl-violet", sizeId: "sz-L", optionIds: [] },
    ],
  },
  {
    id: "gp6",
    slug: "limon-lace-set",
    name: "ست تور و گیپور لیمون",
    category: "set",
    brandId: "br-limon",
    short: "ست ظریف برای موقعیت‌های خاص",
    attributeIds: ["mt-lace", "mt-guipure"],
    createdAt: iso(5),
    variants: [
      { id: "gv19", sku: "LMN-ROS-75", price: 649000, stock: 3, colorId: "cl-rose", sizeId: "sz-75", optionIds: ["uw-yes", "pd-no", "cup-B"] },
      { id: "gv20", sku: "LMN-ROS-80", price: 649000, stock: 2, colorId: "cl-rose", sizeId: "sz-80", optionIds: ["uw-yes", "pd-no", "cup-B"] },
    ],
  },
  {
    id: "gp7",
    slug: "paniz-shapewear",
    name: "گن فرم‌ده سبک پانیذ",
    category: "shapewear",
    brandId: "br-paniz",
    short: "فرم‌دهی ملایم با پارچه تنفس‌پذیر",
    attributeIds: ["mt-microfiber"],
    createdAt: iso(90),
    variants: [
      { id: "gv21", sku: "PNZ-SHP-M", price: 699000, stock: 5, colorId: "cl-cream", sizeId: "sz-M", optionIds: [] },
      { id: "gv22", sku: "PNZ-SHP-L", price: 699000, stock: 4, colorId: "cl-cream", sizeId: "sz-L", optionIds: [] },
    ],
  },
  {
    id: "gp8",
    slug: "limon-modal-sleepwear",
    name: "لباس خواب مودال لیمون",
    category: "sleepwear",
    brandId: "br-limon",
    short: "مودال خنک و نرم برای شب",
    attributeIds: ["mt-modal"],
    createdAt: iso(1),
    variants: [
      { id: "gv23", sku: "LMN-SLP-S", price: 589000, stock: 6, colorId: "cl-lilac", sizeId: "sz-S", optionIds: [] },
      { id: "gv24", sku: "LMN-SLP-M", price: 589000, stock: 5, colorId: "cl-lilac", sizeId: "sz-M", optionIds: [] },
    ],
  },
  {
    id: "gp9",
    slug: "laya-wireless-bra",
    name: "سوتین بدون فنر لعیا",
    category: "bra",
    brandId: "br-laya",
    short: "راحتی بدون فشار، مناسب روزهای طولانی",
    attributeIds: ["mt-cotton"],
    createdAt: iso(25),
    variants: [
      { id: "gv25", sku: "LYA2-WHT-75", price: 349000, stock: 9, colorId: "cl-white", sizeId: "sz-75", optionIds: ["uw-no", "pd-thin", "cup-A"] },
      { id: "gv26", sku: "LYA2-WHT-80", price: 349000, stock: 7, colorId: "cl-white", sizeId: "sz-80", optionIds: ["uw-no", "pd-thin", "cup-B"] },
      { id: "gv27", sku: "LYA2-BLK-80", price: 349000, stock: 4, colorId: "cl-black", sizeId: "sz-80", optionIds: ["uw-no", "pd-thin", "cup-B"] },
      { id: "gv28", sku: "LYA2-BLK-85", price: 365000, stock: 0, colorId: "cl-black", sizeId: "sz-85", optionIds: ["uw-no", "pd-thin", "cup-C"] },
    ],
  },
  {
    id: "gp10",
    slug: "golestan-modal-panty",
    name: "شورت مودال گلستان",
    category: "panty",
    brandId: "br-golestan",
    short: "مودال نرم با کش بالا",
    attributeIds: ["mt-modal"],
    createdAt: iso(35),
    variants: [
      { id: "gv29", sku: "GLS3-LIL-M", price: 179000, stock: 11, colorId: "cl-lilac", sizeId: "sz-M", optionIds: [] },
      { id: "gv30", sku: "GLS3-LIL-L", price: 179000, stock: 10, colorId: "cl-lilac", sizeId: "sz-L", optionIds: [] },
    ],
  },
  {
    id: "gp11",
    slug: "limon-satin-nightgown",
    name: "لباس خواب ساتن لیمون",
    category: "sleepwear",
    brandId: "br-limon",
    short: "ساتن لطیف با دوخت ظریف",
    attributeIds: ["mt-modal"],
    createdAt: iso(2),
    variants: [
      { id: "gv31", sku: "LMN2-ROS-M", price: 729000, stock: 4, colorId: "cl-rose", sizeId: "sz-M", optionIds: [] },
    ],
  },
  {
    id: "gp12",
    slug: "paniz-wireless-everyday",
    name: "سوتین روزمره بدون فنر پانیذ",
    category: "bra",
    brandId: "br-paniz",
    short: "کاپ نخی با پوشش کامل",
    attributeIds: ["mt-cotton"],
    createdAt: iso(45),
    variants: [
      { id: "gv32", sku: "PNZ2-BLK-75", price: 369000, stock: 6, colorId: "cl-black", sizeId: "sz-75", optionIds: ["uw-no", "pd-yes", "cup-B"] },
      { id: "gv33", sku: "PNZ2-BLK-80", price: 369000, stock: 8, colorId: "cl-black", sizeId: "sz-80", optionIds: ["uw-no", "pd-yes", "cup-B"] },
      { id: "gv34", sku: "PNZ2-CRM-85", price: 385000, stock: 3, colorId: "cl-cream", sizeId: "sz-85", optionIds: ["uw-no", "pd-yes", "cup-C"] },
    ],
  },
];

/* ── مشتقات بند ۲۵: فقط از داده واقعی */
export const NEWEST_IDS = [...PRODUCTS_V2]
  .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
  .slice(0, 4)
  .map((p) => p.id);

/** پرفروش‌ها: هنوز داده فروش واقعی نداریم → سکشن مخفی (بند ۷ و ۲۵) */
export const HAS_REAL_SALES_DATA = false;

/** محصولات تخفیف‌دار واقعی: صفر → هیچ بج/سکشن تخفیفی رندر نمی‌شود */
export const HAS_REAL_DISCOUNTS = PRODUCTS_V2.some((p) =>
  p.variants.some((v) => v.salePrice != null && v.salePrice < v.price),
);
