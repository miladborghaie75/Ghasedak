/**
 * تست واحد Size System — بند ۱۲۳: منطق سایز باید مستقل تست شود.
 * اجرا: node --experimental-strip-types --test lib/size-system.test.ts  (یا با tsx)
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { recommendBraSize, recommendLetterSize, isBraLike } from "./size-system";

test("سایز پایه فنر از جدول: زیر سینه ۷۵ → فنر ۷۵", () => {
  const r = recommendBraSize({ underBust: 75, bust: 87 });
  assert.equal(r.valid, true);
  assert.equal(r.band, 75);
  assert.equal(r.sizeTermId, "sz-75");
});

test("کاپ از تفاضل: تفاضل ۱۲ → کاپ B", () => {
  const r = recommendBraSize({ underBust: 75, bust: 87 });
  assert.equal(r.cupTermId, "cup-B");
});

test("قاعده برند پانیذ: بین دو سایز → فنر درشت‌تر", () => {
  // زیر سینه ۷۷ مرز جدول (۷۵/۸۰)؛ با قاعده پانیذ bandShift=up → ۸۰
  const r = recommendBraSize({ underBust: 77, bust: 89 }, { brandId: "br-paniz" });
  assert.equal(r.band, 80);
  assert.ok(r.explanation.includes("پانیذ"));
});

test("قاعده مدل gp2 (لعیا فنردار): کاپ یک پله کوچک‌تر", () => {
  const base = recommendBraSize({ underBust: 75, bust: 87 });
  const withRule = recommendBraSize({ underBust: 75, bust: 87 }, { productId: "gp2" });
  assert.equal(base.cupTermId, "cup-B");
  assert.equal(withRule.cupTermId, "cup-A");
});

test("ورودی نامعتبر: دور سینه کمتر از زیر سینه → invalid با پیام", () => {
  const r = recommendBraSize({ underBust: 80, bust: 78 });
  assert.equal(r.valid, false);
  assert.ok(r.inputError);
});

test("sister size: جایگزین‌ها همیشه فنر ±۵ با کاپ جابه‌جا", () => {
  const r = recommendBraSize({ underBust: 75, bust: 87 });
  assert.deepEqual(r.alternates, ["80/A", "70/C"]);
});

test("سایز حرفی: زیر سینه ۷۶ → M", () => {
  const r = recommendLetterSize(76);
  assert.equal(r.sizeTermId, "sz-M");
  assert.equal(r.valid, true);
});

test("isBraLike: سوتین/ست=true، شورت=false", () => {
  assert.equal(isBraLike("bra"), true);
  assert.equal(isBraLike("set"), true);
  assert.equal(isBraLike("panty"), false);
});
