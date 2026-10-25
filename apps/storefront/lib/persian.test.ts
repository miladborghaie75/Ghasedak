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
  persianLoose,
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

test("normalizePersian: نیم‌فاصله حذف نمی‌شود (فقط در persianLoose تبدیل می‌شود)", () => {
  assert.equal(normalizePersian("بادی\u200cسوت"), "بادی\u200cسوت");
  assert.equal(persianLoose("بادی\u200cسوت"), "بادی سوت");
  assert.equal(persianLoose("بادی سوت"), "بادی سوت");
  assert.equal(persianLoose("بادی‌سوت"), persianLoose("بادی سوت"));
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
    assert.ok(RESERVED_SLUGS.includes(s));
  }
  assert.equal(isReservedSlug("blue-bra"), false);
  assert.equal(isReservedSlug("Cart"), true); // مقایسه بدون توجه به حروف است
});

test("ensureUniqueSlug: پس‌وند -۲/-۳ و بدون حلقهٔ بی‌پایان", async () => {
  const taken = new Set(["bra", "bra-2", "bra-3"]);
  assert.equal(await ensureUniqueSlug("panty", (s) => taken.has(s)), "panty");
  assert.equal(await ensureUniqueSlug("bra", (s) => taken.has(s)), "bra-4");
  assert.equal(
    await ensureUniqueSlug("bra", async (s) => taken.has(s)), // exists ناهمگام (DB) هم کار می‌کند
    "bra-4",
  );
});
