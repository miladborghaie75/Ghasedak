/**
 * نگهبان لحن و کپی پنل ادمین — همان معماری نگهبان فروشگاه، روی هستهٔ مشترک.
 *
 * اجرا:  pnpm --filter @ghasedak/admin test
 *        (یا: node --test apps/admin/lib/copy.test.mjs)
 *
 * مرز لحن ادمین (تصمیم مالک، مهر ۱۴۰۵): صمیمی مثل فروشگاه (۸۰/۲۰) — پیش‌فرض
 * «تو»؛ فهرست فایل‌های رسمی (`FORMAL_FILES`) تا صفحهٔ تعهدی پیدا شود خالی است.
 * متن‌های خنثی بدون خطاب (سرستون جدول، برچسب وضعیت) از قاعده‌ها نمی‌خورند.
 *
 * سه لایه، مثل فروشگاه:
 *   ۱) تست موتور مشترک روی نمونه‌های ادمین‌محور
 *   ۲) قاعده‌ها روی نمونه‌های واقعی این پنل
 *   ۳) اسکن همهٔ فایل‌های ادمین — هر متنی که اپراتور می‌بیند از مرز بیرون نباشد
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
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".turbo", "scripts"]);
const SOURCE = /\.(tsx?|mjs)$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE.test(name)) out.push(full);
  }
  return out;
}

/** همهٔ فایل‌های متن‌دار ادمین (بدون فایل تست). */
function sources() {
  return walk(ROOT)
    .map((file) => ({ rel: relative(ROOT, file).replace(/\\/g, "/"), src: readFileSync(file, "utf8") }))
    .filter((f) => !/\.test\./.test(f.rel))
    .sort((a, b) => a.rel.localeCompare(b.rel));
}

test("موتور: فعل دوم‌شخص جمع از اسم و سوم‌شخص جدا می‌شود", () => {
  for (const w of ["وارد کنید", "ثبت کنید", "بزنید", "می‌توانید", "دارید", "هستید", "انتخاب کنید", "پیدا کردید"]) {
    assert.ok(
      words(w).some(isPluralVerb),
      `«${w}» باید فعل دوم‌شخص جمع داشته باشد`,
    );
  }
  for (const w of ["فاکتور", "بدهکار", "سعید", "تایید", "خرید", "می‌آید", "گلستان"]) {
    assert.ok(
      !words(w).some(isPluralVerb),
      `«${w}» (بدون فعل جمع) نباید نقض لحن شمرده شود`,
    );
  }
});

test("موتور: جهت لحن درست تشخیص داده می‌شود", () => {
  assert.equal(hasFormalTone("فاکتور را ثبت کنید"), true);
  assert.equal(hasFormalTone("شما وارد نشده‌اید"), true);
  assert.equal(hasFormalTone("فاکتور را ثبت کن"), false);
  assert.equal(hasInformalTone("فاکتور را ثبت کن"), true);
  assert.equal(hasInformalTone("در حال بارگذاری…"), false);
  // متن خنثی جدولی — نه صمیمی نه رسمی — نباید ناخواسته «رسمی» تشخیص داده شود
  assert.equal(hasFormalTone("بدهکار دوره"), false);
});

test("قاعده‌ها: لطفاً، کلیک، شکسته‌نویسی، اصطلاح داخلی و خطای بی‌راه‌حل گرفته می‌شوند", () => {
  const withPlease = checkCopy("ثبت سند ناموفق بود؛ لطفاً دوباره تلاش کنید.", { formal: false });
  assert.ok(withPlease.includes("R2"), "«لطفاً» باید گرفته شود");
  assert.ok(checkCopy("روی دکمه کلیک کنید.", { formal: false }).includes("R3"));
  assert.ok(checkCopy("نمیدونی چه درسی ثبت شده؟", { formal: false }).includes("R7"));
  assert.ok(checkCopy("خطای شبکه؛ nonce نامعتبر است.", { formal: false }).includes("R5"));
  const longFailure = "دریافت گزارش از سرور انجام نشد و نمایش داده نمی‌شود.";
  assert.ok(longFailure.length >= 40);
  assert.ok(checkCopy(longFailure, { formal: false }).includes("R4"), "خطای بلند بدون راه‌حل نباید بگذرد");
});

test("مرز لحن: ادمین پیش‌فرض صمیمی است و فایل‌های فهرست رسمی واقعاً موجودند", () => {
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
  const all = sources().filter((f) => f.rel !== "lib/copy-rules.mjs");
  for (const needle of SHARED_STRINGS) {
    const holders = all.filter((f) => hasStringLiteral(f.src, needle)).map((f) => f.rel);
    assert.ok(
      holders.length <= 1,
      `«${needle}» در ${holders.length} فایل آمده (${holders.join(", ")}) — باید از lib/copy.ts بیاید.`,
    );
  }
});

test("CTAها: کنش‌های هم‌معنا یک فعل دارند", () => {
  const all = sources();
  // در ادمین کنش ثبت «ثبت» است؛ واگرایی‌های رایج نباید در دکمه‌ها برگردند
  for (const banned of ["انجام دهید", "اضافه کنید", "ذخیره کنید", "ثبت نمایید"]) {
    const holders = all.filter((f) => f.src.includes(banned)).map((f) => f.rel);
    assert.deepEqual(holders, [], `CTA واگرا («${banned}») در: ${holders.join(", ")}`);
  }
});
