/**
 * تست واحد «بیشترین امتیاز» — گام ۱۱ (نظرات).
 *
 * چرا اینجا و نه روی sortV2: lib/catalog-repo.ts با importهای بی‌پسوند ESM
 * (مثل "./attributes") نوشته شده و اجراکنندهٔ تست Node آن را بارگذاری نمی‌کند.
 * به همین دلیل قاعدهٔ مقایسه در lib/sort.ts (ماژول خالص، بدون import نسبی)
 * نگه داشته می‌شود و sortV2 فقط همان را اعمال می‌کند — یک قاعده، یک تست.
 *
 * قاعده‌ها: امتیازدار بالای بی‌نظر · میانگین نزولی · اختلاف کمتر از نیم‌ستاره
 * معیار نیست (تعداد نظر) · تساوی → جدیدترین · count=0 = بی‌نظر (امتیاز ساختگی ممنوع).
 *
 * اجرا: node --experimental-strip-types --test lib/sort-rating.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { compareRating, parseSortParam } from "./sort.ts";

const mk = (
  id: string,
  createdAt: string,
  rating?: { avg: number | null; count: number },
) => ({ id, createdAt, ...(rating ? { rating } : {}) });

const sortedIds = (list: ReturnType<typeof mk>[]) =>
  [...list].sort(compareRating).map((p) => p.id);

test("امتیازدار بالای بی‌نظر می‌نشیند (حتی اگر بی‌نظر جدیدتر باشد)", () => {
  const unrated = mk("unrated", "2026-10-15T00:00:00.000Z");
  const rated = mk("rated", "2026-09-01T00:00:00.000Z", { avg: 4.5, count: 2 });
  assert.deepEqual(sortedIds([unrated, rated]), ["rated", "unrated"]);
});

test("میانگین بالاتر اول", () => {
  const a = mk("a", "2026-10-01T00:00:00.000Z", { avg: 4, count: 9 });
  const b = mk("b", "2026-10-02T00:00:00.000Z", { avg: 4.5, count: 1 });
  assert.deepEqual(sortedIds([a, b]), ["b", "a"]);
});

test("اختلاف کمتر از نیم‌ستاره معیار ترتیب نیست → تعداد نظر تعیین می‌کند", () => {
  const few = mk("few", "2026-10-03T00:00:00.000Z", { avg: 4.5, count: 2 });
  const many = mk("many", "2026-10-01T00:00:00.000Z", { avg: 4.47, count: 20 });
  assert.deepEqual(sortedIds([few, many]), ["many", "few"]);
});

test("تساوی میانگین و تعداد → جدیدترین", () => {
  const older = mk("older", "2026-09-01T00:00:00.000Z", { avg: 4, count: 5 });
  const newer = mk("newer", "2026-10-01T00:00:00.000Z", { avg: 4, count: 5 });
  assert.deepEqual(sortedIds([older, newer]), ["newer", "older"]);
});

test("بی‌نظرها پایین فهرست و بین خودشان جدیدترین‌اول", () => {
  const old = mk("old", "2026-01-01T00:00:00.000Z");
  const fresh = mk("fresh", "2026-10-10T00:00:00.000Z");
  const rated = mk("rated", "2026-02-01T00:00:00.000Z", { avg: 3, count: 1 });
  assert.deepEqual(sortedIds([old, fresh, rated]), ["rated", "fresh", "old"]);
});

test("count=0 مثل بی‌نظر است — امتیاز ساختگی پذیرفته نمی‌شود", () => {
  const zero = mk("zero", "2026-10-12T00:00:00.000Z", { avg: 5, count: 0 });
  const rated = mk("rated", "2026-10-11T00:00:00.000Z", { avg: 2, count: 1 });
  assert.deepEqual(sortedIds([zero, rated]), ["rated", "zero"]);
});

test("avg=null با count>0 عدد ساختگی نمی‌سازد (۰٫۰ حساب می‌شود، پایین می‌ماند)", () => {
  const nullAvg = mk("nullavg", "2026-10-12T00:00:00.000Z", { avg: null, count: 3 });
  const rated = mk("rated", "2026-10-11T00:00:00.000Z", { avg: 1, count: 1 });
  assert.deepEqual(sortedIds([nullAvg, rated]), ["rated", "nullavg"]);
});

test("parseSortParam: rating پذیرفته می‌شود، مقدار ناشناخته → newest", () => {
  assert.equal(parseSortParam({ sort: "rating" }), "rating");
  assert.equal(parseSortParam({ sort: ["rating", "cheap"] }), "rating");
  assert.equal(parseSortParam({ sort: "fake" }), "newest");
  assert.equal(parseSortParam({}), "newest");
});
