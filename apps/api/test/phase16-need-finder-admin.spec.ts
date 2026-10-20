/**
 * گام ۱۶ — واحدِ مدیریت ویزارد: نرمال‌سازی قاعده و شناسهٔ پایدار (بند ۲۰).
 *
 * چرا بدون DB: این‌ها دروازهٔ ورود rule به DB هستند — اگر شکل خراب رد نشود،
 * ویزارد بی‌صدا خالی/غلط می‌شود و کسی نمی‌فهمد چرا. پس اینجا باید قفل باشند.
 * (تست‌های DB-محورِ همین گام: phase16-need-finder.spec.ts)
 */
import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { normalizeNeedRule } from "../src/catalog/admin-need-finder.controller";

describe("Phase 16 — admin need-finder rule normalization", () => {
  it("null/undefined → null (بدون محدودیت)", () => {
    expect(normalizeNeedRule(null)).toBeNull();
    expect(normalizeNeedRule(undefined)).toBeNull();
  });

  it("شیء خالی → null (گزینهٔ «مهم نیست»)", () => {
    expect(normalizeNeedRule({})).toBeNull();
  });

  it("قاعدهٔ کامل همان‌طور که هست برمی‌گردد (ترتیب کلید مهم نیست)", () => {
    const rule = normalizeNeedRule({
      categories: ["bra", "panty"],
      attributeTerms: ["پنبه"],
      priceMax: 300_000,
      why: "نخ طبیعی",
    });
    expect(rule).toEqual({
      categories: ["bra", "panty"],
      attributeTerms: ["پنبه"],
      priceMax: 300_000,
      why: "نخ طبیعی",
    });
  });

  it("تکراری‌ها حذف و ترتیب حفظ می‌شود", () => {
    const rule = normalizeNeedRule({ categories: ["bra", "bra", "panty", "bra"] });
    expect(rule?.categories).toEqual(["bra", "panty"]);
  });

  it("فهرست خالی → آن بُعد حذف می‌شود (نه «هیچ محدودیتی نیست»)", () => {
    const rule = normalizeNeedRule({ categories: [], attributeTerms: ["پنبه"] });
    expect(rule).toEqual({ attributeTerms: ["پنبه"] });
    expect(rule?.categories).toBeUndefined();
  });

  it("کلید ناشناخته رد می‌شود — نه sanitize بی‌صدا", () => {
    expect(() => normalizeNeedRule({ categoriess: ["bra"] })).toThrow(BadRequestException);
    expect(() => normalizeNeedRule({ categories: ["bra"], priceMin: 100 })).toThrow(
      BadRequestException,
    );
  });

  it("priceMax باید عدد صحیح مثبت باشد", () => {
    expect(() => normalizeNeedRule({ priceMax: "300000" })).toThrow(BadRequestException);
    expect(() => normalizeNeedRule({ priceMax: -1 })).toThrow(BadRequestException);
    expect(() => normalizeNeedRule({ priceMax: 1.5 })).toThrow(BadRequestException);
    expect(() => normalizeNeedRule({ priceMax: 0 })).toThrow(BadRequestException);
  });

  it("آرایه/رشته به‌جای شیء رد می‌شود", () => {
    expect(() => normalizeNeedRule(["bra"])).toThrow(BadRequestException);
    expect(() => normalizeNeedRule("bra")).toThrow(BadRequestException);
  });

  it("آیتم خالی/غیررشته در فهرست رد می‌شود", () => {
    expect(() => normalizeNeedRule({ categories: ["bra", ""] })).toThrow(BadRequestException);
    expect(() => normalizeNeedRule({ categories: ["bra", 7] })).toThrow(BadRequestException);
  });

  it("متن خراب (U+FFFD) در why رد می‌شود", () => {
    expect(() => normalizeNeedRule({ why: "نخ \uFFFD طبیعی" })).toThrow(BadRequestException);
  });

  it("why خالی/فقط‌فاصله حذف می‌شود", () => {
    expect(normalizeNeedRule({ why: "   " })).toBeNull();
    expect(normalizeNeedRule({ why: "" })).toBeNull();
  });
});
