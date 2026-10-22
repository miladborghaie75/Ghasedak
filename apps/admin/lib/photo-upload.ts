/**
 * قواعدِ عکسِ «برنامهٔ عکاسی» — یک‌جا، تا کشیدن‌ورهاکردن و انتخابِ فایل یک
 * نتیجه بدهند.
 *
 * چرا این قواعد سمتِ کلاینت هم هست، وقتی API خودش mime و حجم را می‌سنجد؟
 * چون خطای سرور بعد از آپلودِ چند مگابایتی برمی‌گردد: عکاس فایلِ ۴۰ مگابایتی را
 * می‌کشد، نوار آپلود بالا می‌رود و بعد «فرمت مجاز نیست» می‌بیند. اینجا پیش از
 * ارسال گفته می‌شود — همان قاعده، دو بار، ولی بارِ دوم ارزان است.
 *
 * مقادیر باید با API یکی بمانند (`ALLOWED` و `MAX_UPLOAD` در
 * `apps/api/src/admin/capabilities.controller.ts`). اگر آن‌جا عوض شد، این‌جا هم.
 */

/** فرمت‌هایی که API می‌پذیرد (PDF عمداً نیست — این‌جا فقط عکس) */
export const PHOTO_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** سقفِ حجم — همان ۱۰ مگابایتِ API */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** فرمتِ خوانا برای متنِ خطا — «JPG، PNG یا WebP» */
export const PHOTO_IMAGE_LABEL = "JPG، PNG یا WebP";

export type PhotoFileProblemCode = "type" | "empty" | "size";

export interface PhotoFileProblem {
  code: PhotoFileProblemCode;
  message: string;
}

/**
 * بررسیِ فایل پیش از آپلود — `null` یعنی «بفرست».
 *
 * فقط `type` و `size` لازم است، نه خودِ `File`؛ همان چیزی که API هم می‌سنجد.
 * (پس تست با شیء ساده هم ممکن است، بدون ساختنِ فایلِ واقعی.)
 */
export function checkPhotoFile(file: { type: string; size: number } | null | undefined): PhotoFileProblem | null {
  if (!file) {
    return { code: "empty", message: "عکسی انتخاب نشده است." };
  }
  if (!(PHOTO_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return {
      code: "type",
      message: `این فرمت پذیرفته نمی‌شود — فقط ${PHOTO_IMAGE_LABEL}.`,
    };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { code: "empty", message: "فایل خالی است؛ عکسِ دیگری انتخاب کن." };
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return { code: "size", message: "حجمِ این عکس بیشتر از ۱۰ مگابایت است — نسخهٔ کم‌حجم‌ترش را بگذار." };
  }
  return null;
}

/**
 * آیا این drag فایل حمل می‌کند؟
 *
 * بدون این بررسی، کشیدنِ متن یا لینک روی کادر، هایلایتِ «رها کن» را روشن می‌کند
 * و بعد هیچ فایلی نمی‌رسد — یعنی عکاس دو بار یک کار را انجام می‌دهد.
 */
export function isPhotoDrag(types: readonly string[] | null | undefined, hasFiles?: boolean): boolean {
  if (hasFiles) return true;
  return Array.isArray(types) && types.includes("Files");
}

/**
 * نخستین عکسِ قابل‌قبول از میان فایل‌های رهاشده.
 *
 * چرا «نخستین عکس» و نه «فقط اگر یکی بود»: بعضی سیستم‌ها هنگام کشیدن از فایل‌منیجر
 * چند فایل می‌فرستند؛ پیوستنِ همه به یک کادر معنایی ندارد، ولی رد کردنِ همه هم
 * بی‌دلیل است. اولی می‌نشیند و بقیه نادیده گرفته می‌شوند.
 */
export function firstPhotoFile<T extends { type: string }>(files: ArrayLike<T> | null | undefined): T | null {
  if (!files) return null;
  for (let i = 0; i < files.length; i += 1) {
    const f = files[i];
    if (f && (PHOTO_IMAGE_TYPES as readonly string[]).includes(f.type)) return f;
  }
  return null;
}
