import { BadRequestException } from "@nestjs/common";

/**
 * تاریخ اختیاری از query — گام ۱۲ (`[F1-2]`).
 *
 * چرا تابع مشترک: قبل از این، هر کنترلر خودش `new Date(q.from)` می‌کرد. برای
 * مقدار نامعتبر، `Invalid Date` ساخته می‌شد و Prisma در لایهٔ پایین‌تر با خطای
 * نامفهوم ۵۰۰ می‌داد — یعنی اشتباه تایپی اپراتور، خطای سرور می‌شد. اینجا یک
 * نقطه: مقدار نامعتبر → ۴۰۰ صریح با پیام فارسی، نبود مقدار → `undefined`
 * (یعنی «بدون فیلتر»، نه «امروز»).
 */
export function optionalDate(value: string | undefined, field: string): Date | undefined {
  if (value === undefined || value === "") return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      fieldErrors: { [field]: ["تاریخ معتبر نیست (مثال: 2026-01-01)"] },
    });
  }
  return d;
}
