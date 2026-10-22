/**
 * تستِ جابه‌جاییِ سطرها — همان منطقی که کشیدن و دکمه‌های ↑/↓ استفاده می‌کنند.
 *
 * اجرا:  pnpm --filter @ghasedak/admin test
 *        (یا: node --experimental-strip-types --test apps/admin/lib/reorder.test.ts)
 *
 * چرا این تست مهم است؟ چون ترتیبِ شش قاب، خودِ محتوای بلوک است: اگر جابه‌جایی
 * سطری را گم کند یا دو سطر را یکی کند، مدیر ترتیبی می‌بیند که ذخیره نمی‌شود.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { moveItem } from "./reorder.ts";

const frames = ["set", "bra", "panty", "shapewear", "sport", "sleepwear"];

test("کشیدن به پایین، سطرهای میانی را جابه‌جا می‌کند (نه swap)", () => {
  assert.deepEqual(moveItem(frames, 0, 2), ["bra", "panty", "set", "shapewear", "sport", "sleepwear"]);
});

test("کشیدن به بالا هم همان قاعده را دارد", () => {
  assert.deepEqual(moveItem(frames, 5, 1), ["set", "sleepwear", "bra", "panty", "shapewear", "sport"]);
});

test("جابه‌جایی از اول به آخر و برعکس، کل لیست را دست‌نخورده نگه می‌دارد", () => {
  assert.deepEqual(moveItem(frames, 0, 5), ["bra", "panty", "shapewear", "sport", "sleepwear", "set"]);
  assert.deepEqual(moveItem(frames, 5, 0), ["sleepwear", "set", "bra", "panty", "shapewear", "sport"]);
});

test("مقصدِ نامعتبر سطر را گم نمی‌کند", () => {
  for (const [from, to] of [
    [0, 6],
    [6, 0],
    [-1, 2],
    [2, -1],
    [1.5, 2],
    [2, 1.5],
  ] as const) {
    assert.deepEqual(moveItem(frames, from, to), frames, `from=${from} to=${to}`);
  }
});

test("جابه‌جایی به همان جایگاه، کپیِ تازه می‌دهد ولی ترتیب را عوض نمی‌کند", () => {
  const same = moveItem(frames, 3, 3);
  assert.deepEqual(same, frames);
  assert.notEqual(same, frames, "مرجع باید تازه باشد تا رندر دوباره اتفاق بیفتد");
});

test("آرایهٔ ورودی هرگز جهش پیدا نمی‌کند", () => {
  const input = [...frames];
  moveItem(input, 1, 4);
  assert.deepEqual(input, frames);
});
