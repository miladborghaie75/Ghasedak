/**
 * تست واحد منطق نیازمحور (گام ۱۶ / بند ۹+۲۰) — باید مستقل از UI تست شود.
 * اجرا: node --experimental-strip-types --test lib/needs.test.ts
 *
 * matchesNeed: داخل هر بُعد OR، بین گام‌ها AND؛ rule خالی = بدون محدودیت.
 * parseNeedAnswers: id ناشناخته حذف می‌شود — URL ورودی هرگز به کوئری DB نمی‌رسد.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
// پسوند «.ts» عمدی است — بدون آن runner تست Node ماژول را حل نمی‌کند.
import { matchesNeed, collectNeedFilters, parseNeedAnswers, buildNeedResultHref } from "./needs.ts";
import { NEED_FINDER_FALLBACK } from "@ghasedak/contracts";
import type { ProductV2 } from "./catalog.ts";

/**
 * محصول نمونه — شکل واقعی کاتالوگ: `attributeIds` = id ترم (UUID در DB) و
 * `attributeTerms` = ترم با slug/مقدار. قاعدهٔ ویزارد slug ترم را می‌سنجد.
 */
const product = (over: Partial<ProductV2>): ProductV2 => ({
  id: "p1",
  slug: "p-1",
  name: "محصول",
  category: "bra",
  attributeIds: ["term-cotton"],
  attributeTerms: [{ id: "term-cotton", slug: "پنبه", value: "پنبه" }],
  rating: 0,
  reviewCount: 0,
  variants: [{ id: "v1", sku: "S-1", price: 350_000, salePrice: null, stockQty: 3, sizeTermId: null, colorTermId: null }],
  ...over,
} as ProductV2);

/** محصول با یک جنس مشخص (slug فارسی ترم) */
const withMaterial = (slug: string, over: Partial<ProductV2> = {}): ProductV2 =>
  product({
    attributeIds: [`term-${slug}`],
    attributeTerms: [{ id: `term-${slug}`, slug, value: slug }],
    ...over,
  });

test("AND بین گام‌ها: دسته + جنس هر دو باید صادق باشند", () => {
  const p = product({});
  const comfort = NEED_FINDER_FALLBACK[0].options.find((o) => o.id === "comfort")!.rule!;
  const cotton = NEED_FINDER_FALLBACK[1].options.find((o) => o.id === "priority-cotton")!.rule!;
  assert.equal(matchesNeed(p, [comfort, cotton]), true); // bra + پنبه
  assert.equal(
    matchesNeed(withMaterial("مودال", { category: "panty" }), [comfort, cotton]),
    false, // جنس نخ نیست
  );
});

test("قاعدهٔ قدیمی با id ترم هم می‌خواند (سازگاری دادهٔ قبلی)", () => {
  const p = product({ attributeIds: ["term-cotton"], attributeTerms: [] });
  assert.equal(matchesNeed(p, [{ attributeTerms: ["term-cotton"] }]), true);
});

test("OR داخل یک بُعد: یکی از جنس‌ها کافی است", () => {
  const rule = { attributeTerms: ["پنبه", "مودال"] };
  assert.equal(matchesNeed(withMaterial("مودال"), [rule]), true);
  assert.equal(matchesNeed(withMaterial("تور"), [rule]), false);
});

test("بودجه: حداقل priceMax ملاک است و روی حداقل قیمت مؤثر", () => {
  const cheap = product({});
  const withSale = product({ variants: [{ ...cheap.variants[0], salePrice: 250_000 }] });
  // ارزان‌تر از ۳۰۰ هزار؟ price=350000 ولی sale=250000 → مؤثر ۲۵۰ هزار
  assert.equal(matchesNeed(withSale, [{ priceMax: 300_000 }]), true);
  assert.equal(matchesNeed(cheap, [{ priceMax: 300_000 }]), false);
  // چند سقف بودجه → سخت‌ترین (min) اعمال می‌شود
  assert.equal(matchesNeed(withSale, [{ priceMax: 500_000 }, { priceMax: 200_000 }]), false);
});

test("rule خالی/null = بدون محدودیت — «مهم نیست» هیچ محصولی را حذف نمی‌کند", () => {
  assert.equal(matchesNeed(product({}), [null]), true);
  assert.equal(matchesNeed(product({}), [null, undefined, {}]), true);
});

test("تجمیع ابعاد برای متن دلیل: اجتماع OR + سقف بودجه min", () => {
  const r = collectNeedFilters([
    { categories: ["bra"], attributeTerms: ["پنبه"] },
    { attributeTerms: ["مودال"], priceMax: 500_000 },
    null,
  ]);
  assert.deepEqual(r.categories, ["bra"]);
  assert.deepEqual(r.attributeTerms, ["پنبه", "مودال"]);
  assert.equal(r.priceMax, 500_000);
});

test("parseNeedAnswers: id ناشناخته/خارج از مجموعه حذف می‌شود", () => {
  const steps = NEED_FINDER_FALLBACK;
  const answers = parseNeedAnswers(
    { a0: "sport", a1: "priority-look", a2: "budget-500", a3: "باید-نادیده-بماند" },
    steps,
  );
  assert.deepEqual(answers, ["sport", "priority-look", "budget-500"]);
  // id جعلی حتی در جایگاه درست هم نمی‌تواند وارد شود
  assert.deepEqual(
    parseNeedAnswers({ a0: "DROP TABLE products;--" }, steps),
    [],
  );
});

test("buildNeedResultHref: ترتیب پاسخ‌ها حفظ می‌شود و URL اشتراک‌پذیر است", () => {
  const href = buildNeedResultHref(["sport", "priority-comfort", "budget-300"]);
  assert.equal(href, "/need/result?a0=sport&a1=priority-comfort&a2=budget-300");
});
