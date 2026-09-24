/**
 * بارکد EAN-13 داخلی — بند ۱۱۶: یکتا و قابل ویرایش.
 * ساختار: 690 (پیشوند فروشگاه) + کد دسته (۲ رقم) + سریال ۹ رقم + رقم کنترل.
 * کاربر می‌تواند بعداً آن را ویرایش کند؛ یکتایی با unique DB تضمین می‌شود.
 */

/** کد دو رقمی هر دسته سطح ۱ — برای دسته‌های جدید به ترتیب ایجاد تخصیص می‌یابد */
const CATEGORY_CODES: Record<string, string> = {
  bra: "01",
  panty: "02",
  set: "03",
  shapewear: "04",
  sport: "05",
  sleepwear: "06",
};

export function categoryBarcodeCode(slug?: string | null, categoryId?: string | null): string {
  if (slug && CATEGORY_CODES[slug]) return CATEGORY_CODES[slug];
  // دسته ناشناخته → از hash پایدار id دسته دو رقم بساز
  const src = (categoryId ?? "gen") + (slug ?? "");
  let h = 0;
  for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) % 100;
  return String(h).padStart(2, "0");
}

function ean13CheckDigit(digits12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(digits12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return String((10 - (sum % 10)) % 10);
}

/**
 * بارکد بعدی برای دسته — بر اساس بیشترین سریال موجود در DB.
 * هر کلاینتی که productVariant.findFirst با امضای حداقلی Prisma دارد.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface BarcodePrismaLike {
  productVariant: {
    findFirst: (args: any) => Promise<{ barcode: string | null } | null>;
  };
}

export async function nextBarcodeForCategory(
  prisma: BarcodePrismaLike,
  categorySlug: string | null | undefined,
  categoryId: string | null | undefined,
): Promise<string> {
  const cat = categoryBarcodeCode(categorySlug, categoryId);
  const prefix = `690${cat}`;
  // بیشترین سریال موجود با این پیشوند
  const last = await prisma.productVariant.findFirst({
    where: { barcode: { startsWith: prefix } },
    orderBy: { barcode: "desc" },
    select: { barcode: true },
  });
  let serial = 1;
  if (last?.barcode && last.barcode.length === 13) {
    serial = Number(last.barcode.slice(5, 12)) + 1;
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    const body = `${prefix}${String(serial).padStart(7, "0")}`; // 690 + 2 + 7 = 12 رقم
    const candidate = body + ean13CheckDigit(body);
    const dup = await prisma.productVariant.findFirst({
      where: { barcode: candidate },
      select: { barcode: true },
    });
    if (!dup) return candidate;
    serial += 1;
  }
  // fallback — تقریباً غیرقابل وقوع
  return `${prefix}${String(Date.now() % 10_000_000).padStart(7, "0")}`;
}
