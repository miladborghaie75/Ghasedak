/**
 * تست واحد جست‌وجوی فارسی (گام ۲۰ — بستهٔ A): نرمال‌سازی ی/ک عربی، نیم‌فاصله، مترادف‌ها.
 * اجرا: node --experimental-strip-types --test lib/persian-search.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { expandQuery, searchDocs, SYNONYM_MIN_DIRECT_HITS, type SearchableDoc } from "./persian-search.ts";

const doc = (name: string, short = ""): SearchableDoc => ({ name, short });

const POOL: SearchableDoc[] = [
  doc("سوتین ورزشی اسپرت قاصدک", "بدون فنر، پارچه نخی"),
  doc("شورت پنبه‌ای ساده", "فرم روزمره"),
  doc("بادی‌سوت تور", "یک‌تکه مجلسی"),
  doc("گن شکل‌دهندهٔ شکم", "زیر لباس"),
  doc("نایتی ابریشمی", "راحتی شب"),
  doc("لباس خواب زنانه ساده", "پارچه لطیف"),
  doc("پیراهن خواب نخی", "راحتی شب"),
  doc("شلوار خانگی نخی", "نرم و سبک"),
  doc("تیشرت خواب نخی", "راحتی شب"),
];

test("«سوتين» با ي عربی همان «سوتین» را پیدا می‌کند", () => {
  const r = searchDocs("سوتين", POOL); // ي عربی به‌جای ی فارسی
  assert.equal(r.length >= 1, true);
  assert.equal(r[0].name, "سوتین ورزشی اسپرت قاصدک");
});

test("«نايتي» (ي عربی) نتیجهٔ لباس‌خواب می‌دهد — مترادف نایتی↔لباس خواب", () => {
  const r = searchDocs("نايتي", POOL);
  assert.equal(r.length >= 1, true);
  assert.equal(r[0].name, "نایتی ابریشمی"); // نتیجهٔ مستقیم اول می‌آید
  // مترادف: محصولی که فقط «لباس خواب» دارد (بدون «نایتی») هم ضمیمه می‌شود
  assert.equal(
    r.some((d) => d.name === "لباس خواب زنانه ساده"),
    true,
  );
});

test("مترادف دوطرفه: «قیف» محصولات سوتین را می‌آورد", () => {
  const r = searchDocs("قیف", POOL);
  assert.equal(r.some((d) => d.name === "سوتین ورزشی اسپرت قاصدک"), true);
});

test("نیم‌فاصله: ورودی «بادی سوت» محصول «بادی‌سوت» را پیدا می‌کند", () => {
  const r = searchDocs("بادی سوت", POOL);
  assert.equal(r.length >= 1, true);
  assert.equal(r[0].name, "بادی‌سوت تور");
});

test("مترادف وقتی اعمال می‌شود که نتیجهٔ مستقیم کم باشد", () => {
  // «گن» یک نتیجهٔ مستقیم دارد (کمتر از آستانه) → مترادف «شکل» ضمیمه می‌شود
  const few = searchDocs("گن", POOL);
  assert.equal(few.length >= 1, true);
  assert.equal(few[0].name, "گن شکل‌دهندهٔ شکم");
  // کوئری‌ای که خودش مستقیم زیاد دارد مترادف نمی‌گیرد
  const many = searchDocs("نخی", POOL);
  assert.equal(many.length >= SYNONYM_MIN_DIRECT_HITS, true);
  assert.equal(many.some((d) => d.name === "نایتی ابریشمی"), false);
});

test("کوئری خالی → همان pool بدون فیلتر", () => {
  assert.deepEqual(searchDocs("   ", POOL), POOL);
  assert.deepEqual(searchDocs("", POOL), POOL);
});

test("expandQuery: فقط کلیدهای داخل کوئری بسط داده می‌شوند و مقدار تکراری حذف می‌شود", () => {
  assert.deepEqual(expandQuery("نایتی"), ["لباس خواب"]);
  assert.deepEqual(expandQuery("پیراهن خواب زنانه"), ["لباس خواب"]);
  // «بادی سوت» حاوی مترادف «سوت» است → کلید «ست» دوطرفه ضمیمه می‌شود (یک پَرَه، نه زنجیره)
  assert.deepEqual(expandQuery("بادی سوت"), ["ست"]);
  assert.deepEqual(expandQuery("کیف"), []);
});
