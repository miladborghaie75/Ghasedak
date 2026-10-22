/**
 * پارسر CSV ورودی (گام ۱۳ · `[F1-3]`) — خالص، بدون وابستگی، تست‌پذیر.
 *
 * چرا دست‌نویس: پروژه هیچ پارسر CSV ندارد (تنها کد CSV، **نویسندهٔ** گام ۱۲
 * است در `accounting/csv.ts`). برای ورودی اپراتور، همان RFC4180 کافی است و
 * یک پارسر ~۱۵۰ خطی ریسک زنجیرهٔ تأمین ندارد. اگر روزی Excel بومی خواسته شد،
 * آن یک مسئلهٔ جدا است (zip + XML) و جای این فایل را نمی‌گیرد.
 *
 * سه نکتهٔ عمدی:
 *  ۱) BOM اول فایل حذف می‌شود — همان چیزی که خودمان در خروجی CSV می‌گذاریم
 *     و Excel هم هنگام «Save as CSV UTF-8» می‌گذارد. اگر حذف نشود، نام اولین
 *     ستون `\uFEFFsku` می‌شود و هیچ ستونی تطبیق نمی‌خورد.
 *  ۲) نرمال‌سازی ارقام فارسی/عربی و حروف عربی (`ي`/`ك`) در همین لایه انجام
 *     می‌شود، نه در سرویس: وگرنه هر مصرف‌کنندهٔ تازه باید دوباره همان را بنویسد.
 *  ۳) خطا با شمارهٔ **ردیف منطقی** برمی‌گردد (هدر = ۱)، نه پیام کلی؛ اپراتور
 *     باید بداند کدام ردیف فایل را درست کند.
 */

export class CsvParseError extends Error {
  constructor(
    public readonly row: number,
    message: string,
  ) {
    super(message);
    this.name = "CsvParseError";
  }
}

export interface CsvRecord {
  /** شمارهٔ ردیف منطقی با هدر = ۱ — همان چیزی که کاربر در Excel می‌بیند */
  rowNo: number;
  cells: string[];
}

export interface ParsedCsv {
  header: string[];
  rows: CsvRecord[];
}

/**
 * خواندن متن CSV به هدر + ردیف‌ها.
 *
 * - نقل‌قول دوتایی، کاما/خط جدید داخل نقل‌قول، `""` به‌عنوان نقل‌قول جفت.
 * - پایان خط `\n`، `\r\n` و `\r`.
 * - ردیف کاملاً خالی نادیده گرفته می‌شود (فایل‌های Excel اغلب ردیف خالی آخر دارند).
 * - ردیف کوتاه با رشتهٔ خالی پر می‌شود تا تطبیق ستون‌ها جابه‌جا نشود.
 */
export function parseCsv(text: string): ParsedCsv {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let rowNo = 1;
  let i = 0;

  const endField = () => {
    fields.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    // ردیف خالی (یک فیلد خالی) دور ریخته می‌شود — نه خطا
    if (!(fields.length === 1 && fields[0] === "")) records.push(fields);
    fields = [];
    rowNo += 1;
  };

  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      endRecord();
      i += ch === "\r" && src[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (inQuotes) {
    throw new CsvParseError(rowNo, "نقل‌قول باز در فایل CSV بسته نشده است — احتمالاً کاما یا خط جدید داخل یک سلول جا افتاده.");
  }
  // آخرین ردیف بدون پایان خط
  if (field !== "" || fields.length > 0) endRecord();

  if (records.length === 0 || records.every((r) => r.every((c) => c.trim() === ""))) {
    throw new CsvParseError(1, "فایل CSV خالی است.");
  }
  const [header, ...data] = records;
  return {
    header: header.map((h) => h.trim()),
    rows: data.map((cells, idx) => ({ rowNo: idx + 2, cells })),
  };
}

// ---------------------------------------------------------------- نرمال‌سازی

/** ارقام فارسی/عربی → لاتین (اعداد همیشه لاتین در DB ذخیره می‌شوند) */
export function normalizeDigits(input: string): string {
  return input
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * نرمال‌سازی متن فارسی: `ي`/`ك` عربی → فارسی، ارقام لاتین، و حذف
 * کاراکترهای جهت‌دهی (LRM/RLM) که از کپی‌پیست Excel می‌آیند.
 * نیم‌فاصله (ZWNJ) **حفظ** می‌شود چون بخشی از املای درست «لباس زیر» نیست
 * ولی در «می‌رود» هست؛ برای تطبیق نام‌ها جداگانه یک کلید بدون ZWNJ می‌سازیم.
 */
export function normalizePersian(input: string): string {
  return normalizeDigits(input)
    .replace(/\u064A/g, "\u06CC")
    .replace(/\u0643/g, "\u06A9")
    .replace(/[\u200E\u200F\u202A-\u202E]/g, "")
    .replace(/\u00A0/g, " ")
    .trim();
}

/** کلید مقایسهٔ نام/هدر: بدون ZWNJ، فاصله‌ها به `_`، فقط حروف/ارقام */
export function normalizeKey(input: string): string {
  return normalizePersian(input)
    .replace(/[\s\u200C\u200D]+/g, "_")
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

/**
 * عدد صحیح تومانی از سلول انسانی: «۲۵۰٬۰۰۰»، «250,000 تومان»، «+12».
 * `null` یعنی خالی (برای فیلدهای اختیاری)؛ `NaN` یعنی نامعتبر.
 */
export function parseMoneyCell(input: string | undefined): number | null | typeof NaN {
  const raw = normalizePersian(input ?? "").replace(/(تومان|ریال|تومان\s*)/g, "").trim();
  if (raw === "" || raw === "-") return null;
  const cleaned = raw.replace(/[,\u066C\u060C\u00A0\s+]/g, "").replace(/^\+/, "");
  if (!/^-?\d+$/.test(cleaned)) return NaN;
  const n = Number(cleaned);
  return Number.isSafeInteger(n) ? n : NaN;
}

/** عدد صحیح نامنفی (موجودی) — `null` خالی، `NaN` نامعتبر */
export function parseQtyCell(input: string | undefined): number | null | typeof NaN {
  const n = parseMoneyCell(input);
  if (n === null || Number.isNaN(n)) return n;
  if (!Number.isSafeInteger(n) || n < 0) return NaN;
  return n;
}

// ---------------------------------------------------------------- هدرها

/** ستون‌های شناخته‌شده — ترتیب این شیء همان ترتیب قالب نمونه است */
export const COLUMNS = [
  "sku",
  "name",
  "slug",
  "category",
  "brand",
  "status",
  "price",
  "sale_price",
  "cost_price",
  "stock",
  "barcode",
] as const;

export type ColumnKey = (typeof COLUMNS)[number];

/** برچسب فارسی هر ستون — قالب نمونه و راهنمای UI از همین خوانده می‌شود */
export const COLUMN_LABELS: Record<ColumnKey, string> = {
  sku: "SKU",
  name: "نام محصول",
  slug: "اسلاگ",
  category: "دسته",
  brand: "برند",
  status: "وضعیت",
  price: "قیمت",
  sale_price: "قیمت حراج",
  cost_price: "بهای خرید",
  stock: "موجودی",
  barcode: "بارکد",
};

/**
 * نام‌های پذیرفته‌شدهٔ هر ستون (فارسی و انگلیسی).
 * چرا این‌قدر: فایل از Excel می‌آید و هر اپراتور سرستون را جور دیگری
 * می‌نویسد؛ رد کردن فایل به‌خاطر «قیمت (تومان)» در برابر «قیمت» فقط
 * آزاردهنده است و سودی ندارد.
 */
const HEADER_ALIASES: Record<ColumnKey, string[]> = {
  sku: ["sku", "کد_کالا", "کد_sku", "کدsku", "شناسه_کالا", "کد"],
  name: ["name", "نام", "نام_محصول", "عنوان", "product_name"],
  slug: ["slug", "اسلاگ", "نامک", "آدرس"],
  category: ["category", "دسته", "دسته_بندی", "گروه", "دسته_محصول"],
  brand: ["brand", "برند", "مارک", "برند_محصول"],
  status: ["status", "وضعیت", "وضعیت_انتشار"],
  price: ["price", "قیمت", "قیمت_پایه", "قیمت_فروش", "base_price", "قیمت_تومان"],
  sale_price: ["sale_price", "قیمت_حراج", "قیمت_تخفیف", "حراج", "sale"],
  cost_price: ["cost_price", "بهای_خرید", "قیمت_خرید", "بهای_تمام_شده", "cost"],
  stock: ["stock", "موجودی", "موجودی_اولیه", "تعداد", "stock_qty"],
  barcode: ["barcode", "بارکد", "بار_کد"],
};

export interface HeaderMap {
  /** کلید ستون → ایندکس سلول */
  index: Partial<Record<ColumnKey, number>>;
  /** سرستون‌هایی که شناخته نشدند — برای هشدار، نه خطا */
  unknown: string[];
}

/** ساخت نقشهٔ ستون از سرستون‌های فایل */
export function mapHeader(header: string[]): HeaderMap {
  const index: Partial<Record<ColumnKey, number>> = {};
  const unknown: string[] = [];
  const aliasToKey = new Map<string, ColumnKey>();
  for (const key of COLUMNS) {
    for (const alias of HEADER_ALIASES[key]) aliasToKey.set(normalizeKey(alias), key);
  }
  header.forEach((raw, i) => {
    const k = aliasToKey.get(normalizeKey(raw));
    if (!k) {
      if (normalizeKey(raw)) unknown.push(raw);
      return;
    }
    // اولین ستون برنده است — ستون تکراری بی‌صدا جای قبلی را نمی‌گیرد
    if (index[k] === undefined) index[k] = i;
  });
  return { index, unknown };
}

/** وضعیت‌های پذیرفته‌شده در فایل — فارسی و کد انگلیسی */
export function parseStatusCell(input: string | undefined): "DRAFT" | "PUBLISHED" | "ARCHIVED" | null | "INVALID" {
  const key = normalizeKey(input ?? "");
  if (!key) return null;
  const map: Record<string, "DRAFT" | "PUBLISHED" | "ARCHIVED"> = {
    draft: "DRAFT",
    published: "PUBLISHED",
    archived: "ARCHIVED",
    پیش_نویس: "DRAFT",
    پیشنویس: "DRAFT",
    منتشرشده: "PUBLISHED",
    منتشر: "PUBLISHED",
    فعال: "PUBLISHED",
    آرشیو: "ARCHIVED",
    بایگانی: "ARCHIVED",
  };
  return map[key] ?? "INVALID";
}
