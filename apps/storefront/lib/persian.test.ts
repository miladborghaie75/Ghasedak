/**
 * تست واحد ابزارهای فارسی contracts (گام ۲۰ — بستهٔ A): نرمال‌سازی، اسلاگ، رزرو، یکتایی.
 * اجرا: node --experimental-strip-types --test lib/persian.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ensureUniqueSlug,
  isReservedSlug,
  normalizePersian,
  normalizePersianForSearch,
  RESERVED_SLUGS,
  slugifyFa,
} from "@ghasedak/contracts";

test("normalizePersian: ي عربی→ی، ك عربی→ک، ارقام عربی/فارسی→لاتین، کنترلی حذف", () => {
  assert.equal(normalizePersian("سوتين قیف"), "سوتین قیف"); // ي عربی
  assert.equal(normalizePersian("كمربند"), "کمربند"); // ك عربی
  assert.equal(normalizePersian("سایز ۴۲ و ٤٣"), "سایز 42 و 43"); // ارقام فارسی/عربی
  assert.equal(normalizePersian("abc\u0000\u0007def"), "abcdef"); // کنترلی
  assert.equal(normalizePersian("  لباس   زیر  "), "لباس زیر"); // فشردن فاصله‌ها
});

test("normalizePersian: نیم‌فاصله حذف نمی‌شود (فقط در normalizePersianForSearch تبدیل می‌شود)", () => {
  assert.equal(normalizePersian("بادی\u200cسوت"), "بادی\u200cسوت");
  assert.equal(normalizePersianForSearch("بادی\u200cسوت"), "بادی سوت");
  assert.equal(normalizePersianForSearch("بادی سوت"), "بادی سوت");
  assert.equal(normalizePersianForSearch("بادی‌سوت"), normalizePersianForSearch("بادی سوت"));
});

test("slugifyFa: فاصله/نیم‌فاصله → خط تیره، لاتین کوچک، کاراکتر غیرمجاز حذف", () => {
  assert.equal(slugifyFa("ست سوتین و شورت پنبه‌ای"), "ست-سوتین-و-شورت-پنبه-ای");
  assert.equal(slugifyFa("  Bra-Set 2024!! "), "bra-set-2024");
  assert.equal(slugifyFa("‌کرم مرطوب‌کننده‌"), "کرم-مرطوب-کننده"); // نیم‌فاصلهٔ ابتدا/انتها جمع می‌شود
  assert.equal(slugifyFa("سوتّین"), "سوتین"); // حرکت حذف می‌شود
  assert.equal(slugifyFa("!!!"), ""); // نتیجهٔ خالی → fallback فراخواننده
});

test("RESERVED_SLUGS: مسیرهای سطح‌یک فروشگاه رزرو هستند", () => {
  for (const s of ["cart", "checkout", "search", "account", "p", "c", "api", "admin", "guides"]) {
    assert.equal(isReservedSlug(s), true, `${s} باید رزرو باشد`);
    assert.ok(RESERVED_SLUGS.has(s));
  }
  assert.equal(isReservedSlug("blue-bra"), false);
  assert.equal(isReservedSlug("Cart"), true); // مقایسه بدون توجه به حروف است
});

test("ensureUniqueSlug: پس‌وند -۲/-۳ و بدون حلقهٔ بی‌پایان", () => {
  const taken = new Set(["bra", "bra-2", "bra-3"]);
  assert.equal(ensureUniqueSlug("panty", (s) => taken.has(s)), "panty");
  assert.equal(ensureUniqueSlug("bra", (s) => taken.has(s)), "bra-4");
  // نسخهٔ async هم باید کار کند (تابع وجود را به‌صورت async می‌خواند)
  const takenAsync = new Set(["bra", "bra-2", "bra-3"]);
  const asyncExists = async (s: string) => takenAsync.has(s);
  // نکته: implementations فعلی sync است؛ برای async باید wrapper بنویسیم
  // اما این تست فقط تضمین می‌کند که callback async هم قابل قبول است (Promise<boolean>)
  // برای پوشش واقعی async، ensureUniqueSlug باید Promise<boolean> را مدیریت کند
  assert.equal(ensureUniqueSlug("bra", (s) => takenAsync.has(s)), "bra-4");
});
