/**
 * نگهبان لحن و کپی فروشگاه — تست خودکار با اجراکنندهٔ تست خود Node (بدون وابستگی تازه).
 *
 * اجرا:  pnpm --filter @ghasedak/storefront test
 *        (یا: node --test apps/storefront/lib/copy.test.mjs)
 *
 * این تست سه لایه دارد:
 *   ۱) تست خودِ موتور (بدون آن، نگهبان می‌تواند اشتباه «نقض» بسازد و بی‌اعتبار شود)
 *   ۲) تست قاعده‌ها روی نمونه‌های کاذب/واقعی
 *   ۳) اسکن همهٔ فایل‌های فروشگاه: هر متنی که کاربر می‌بیند از مرز لحن بیرون نزده باشد
 *
 * چرا .mjs نه .ts؟ اجراکنندهٔ تست Node برای import بدون پسوند TS به تنظیمات پروژه
 * دست می‌برد؛ نگهبان نباید به ابزار اضافه وابسته باشد. جزئیات: docs/copy-tone-guide.md
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  checkCopy,
  extractCopy,
  FORMAL_FILES,
  hasFormalTone,
  hasInformalTone,
  hasStringLiteral,
  isFormalFile,
  isPluralVerb,
  RULE_DETAIL,
  SHARED_STRINGS,
  words,
} from "./copy-rules.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".turbo", "og-fonts", "scripts"]);
const SOURCE = /\.(tsx?|jsx?)$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE.test(name)) out.push(full);
  }
  return out;
}

/** همهٔ فایل‌های متن‌دار فروشگاه (بدون فایل تست). */
function sources() {
  return walk(ROOT)
    .map((file) => ({ rel: relative(ROOT, file).replace(/\\/g, "/"), src: readFileSync(file, "utf8") }))
    .filter((f) => !/\.test\./.test(f.rel))
    .sort((a, b) => a.rel.localeCompare(b.rel));
}

test("موتور: فعل دوم‌شخص جمع از اسم و سوم‌شخص جدا می‌شود", () => {
  // واقعی — باید بگیرد
  for (const w of ["بزنید", "بگیرید", "بنویسید", "می‌کنید", "نمی‌روید", "می‌آیید", "کنید", "دارید", "هستید", "باشید", "گرفتید", "کرده‌اید", "بودید"]) {
    assert.equal(isPluralVerb(w), true, `«${w}» باید فعل دوم‌شخص جمع شمرده شود`);
  }
  // کاذب — نباید بگیرد (این‌ها همان جاهایی بودند که نسخهٔ اول موتور اشتباه می‌گرفت)
  for (const w of ["خرید", "جدید", "تایید", "تأکید", "امید", "می‌آید", "نمی‌آید", "بگوید", "گلستان", "استان", "داستان", "سعید"]) {
    assert.equal(isPluralVerb(w), false, `«${w}» نباید نقض لحن شمرده شود`);
  }
});

test("موتور: جهت لحن درست تشخیص داده می‌شود", () => {
  assert.equal(hasFormalTone("سفارش شما ثبت شد"), true);
  assert.equal(hasFormalTone("متر را دور سینه بگیرید"), true);
  assert.equal(hasFormalTone("سایزت را نمی‌دانی؟"), false);
  assert.equal(hasInformalTone("سایزت را نمی‌دانی؟"), true);
  assert.equal(hasInformalTone("سبد خرید شما خالی است"), false);
});

test("موتور: علامت نگارشی فارسی از واژه جدا می‌شود", () => {
  // «دارید؟» نباید به‌عنوان یک واژهٔ ناشناخته از نگهبان فرار کند
  assert.deepEqual(words("کد تخفیف دارید؟"), ["کد", "تخفیف", "دارید"]);
  assert.ok(checkCopy("کد تخفیف دارید؟", { formal: false }).includes("R1"));
  assert.ok(checkCopy("سایزت را ببین؛", { formal: true }).includes("R1"), "لحن صمیمی در صفحهٔ حقوقی هم نقض است");
});

test("قاعده‌ها: لطفاً، کلیک، شکسته‌نویسی، اصطلاح داخلی و خطای بی‌راه‌حل گرفته می‌شوند", () => {
  const withPlease = checkCopy("ثبت سفارش ناموفق بود؛ لطفاً دوباره تلاش کنید.", { formal: false });
  assert.ok(withPlease.includes("R2"), "«لطفاً» باید گرفته شود");
  assert.ok(withPlease.includes("R1"), "خطاب جمع باید گرفته شود");
  assert.ok(checkCopy("روی دکمه کلیک کنید تا افزوده شود.", { formal: false }).includes("R3"));
  assert.ok(checkCopy("مبلغ را وارد کنید تا ببینی", { formal: false }).includes("R1"));
  assert.ok(checkCopy("نمیدونی چی میخوای؟", { formal: false }).includes("R7"));
  assert.ok(checkCopy("خطای شبکه؛ توکن امنیتی نامعتبر است.", { formal: false }).includes("R5"));
  const longFailure = "ارتباط با فروشگاه برقرار نشد و سبد خرید قابل نمایش نیست در این لحظه.";
  assert.ok(longFailure.length >= 40);
  assert.ok(checkCopy(longFailure, { formal: false }).includes("R4"), "خطای بلند بدون راه‌حل نباید بگذرد");
});

test("مرز لحن: صفحات حقوقی رسمی‌اند و هیچ فایل دیگری رسمی نیست", () => {
  // فایل‌های مرز باید واقعاً وجود داشته باشند (نگهبانِ خودِ فهرست، نه فقط متن)
  for (const rel of FORMAL_FILES) {
    assert.ok(statSync(join(ROOT, rel)).isFile(), `فایل مرز رسمی پیدا نشد: ${rel}`);
  }

  const violations = [];
  for (const { rel, src } of sources()) {
    const formal = isFormalFile(rel);
    for (const piece of extractCopy(src, rel)) {
      for (const rule of checkCopy(piece.text, { formal })) {
        violations.push(`${rule} ${rel}:${piece.line} — ${RULE_DETAIL[rule]}\n     «${piece.text}»`);
      }
    }
  }
  assert.deepEqual(violations, [], `\n${violations.join("\n")}\n`);
});

test("R6: متن‌های مشترک فقط یک منبع دارند", () => {
  // خودِ پیکربندی فهرست را نگه می‌دارد؛ در شمارش منبع حساب نمی‌شود
  const all = sources().filter((f) => f.rel !== "lib/copy-rules.mjs");
  for (const needle of SHARED_STRINGS) {
    // فقط «تعریف واقعی» رشته شمرده می‌شود — مصرف از COPY تکرار نیست
    const holders = all.filter((f) => hasStringLiteral(f.src, needle)).map((f) => f.rel);
    assert.ok(
      holders.length <= 1,
      `«${needle}» در ${holders.length} فایل آمده (${holders.join(", ")}) — باید از lib/copy.ts بیاید.`,
    );
  }
});

test("CTAها: کنش‌های هم‌معنا یک فعل دارند", () => {
  const all = sources();
  // «مشاهده» فعل مشترک پیمایش است؛ «دیدن/رفتن به» نباید در دکمه‌ها برگردند
  for (const banned of ["رفتن به فروشگاه", "دیدن محصولات", "دیدن سوتین‌ها"]) {
    const holders = all.filter((f) => f.src.includes(banned)).map((f) => f.rel);
    assert.deepEqual(holders, [], `CTA واگرا («${banned}») در: ${holders.join(", ")}`);
  }
});
