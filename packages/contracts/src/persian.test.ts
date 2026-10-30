import {
  normalizePersian,
  normalizePersianForSearch,
  slugifyFa,
  ensureUniqueSlug,
  isReservedSlug,
  validateSlug,
  expandSearchQuery,
  RESERVED_SLUGS,
} from "./persian";

describe("normalizePersian", () => {
  test("converts Arabic yeh to Persian yeh", () => {
    expect(normalizePersian("ي")).toBe("ی");
    expect(normalizePersian("ك")).toBe("ک");
  });

  test("converts Arabic digits to Latin", () => {
    expect(normalizePersian("١٢٣")).toBe("123");
  });

  test("converts Persian digits to Latin", () => {
    expect(normalizePersian("۱۲۳")).toBe("123");
  });

  test("removes control characters", () => {
    expect(normalizePersian("test\u0000\u001F")).toBe("test");
  });

  test("normalizes whitespace", () => {
    expect(normalizePersian("a  b   c")).toBe("a b c");
    expect(normalizePersian("\t\n")).toBe("");
  });

  test("preserves ZWNJ (half-space)", () => {
    expect(normalizePersian("بادی\u200Cسوت")).toBe("بادی\u200Cسوت");
  });
});

describe("normalizePersianForSearch", () => {
  test("converts ZWNJ to space for search matching", () => {
    expect(normalizePersianForSearch("بادی\u200Cسوت")).toBe("بادی سوت");
    expect(normalizePersianForSearch("سوت\u200Cین")).toBe("سوت ین");
  });
});

describe("slugifyFa", () => {
  test("basic Persian slug", () => {
    expect(slugifyFa("محصول تست")).toBe("محصول-تست");
  });

  test("handles ZWNJ", () => {
    expect(slugifyFa("بادی\u200Cسوت")).toBe("بادی-سوت");
  });

  test("converts spaces to hyphens", () => {
    expect(slugifyFa("لباس زیر قاصدک")).toBe("لباس-زیر-قاصدک");
  });

  test("lowercases Latin letters", () => {
    expect(slugifyFa("Product Test")).toBe("product-test");
  });

  test("removes invalid characters", () => {
    expect(slugifyFa("محصول@#$تست")).toBe("محصول-تست");
  });

  test("collapses multiple hyphens", () => {
    expect(slugifyFa("محصول--تست")).toBe("محصول-تست");
    expect(slugifyFa("---محصول---")).toBe("محصول");
  });

  test("trims hyphens from start/end", () => {
    expect(slugifyFa("-محصول-")).toBe("محصول");
  });

  test("empty input returns empty", () => {
    expect(slugifyFa("")).toBe("");
    expect(slugifyFa("   ")).toBe("");
  });
});

describe("ensureUniqueSlug", () => {
  test("returns base if not exists", () => {
    const exists = (s: string) => s === "taken";
    expect(ensureUniqueSlug("free", exists)).toBe("free");
  });

  test("adds -2, -3... if exists", () => {
    const taken = new Set(["product", "product-2", "product-3"]);
    const exists = (s: string) => taken.has(s);
    expect(ensureUniqueSlug("product", exists)).toBe("product-4");
  });
});

describe("isReservedSlug", () => {
  test("returns true for reserved slugs", () => {
    expect(isReservedSlug("cart")).toBe(true);
    expect(isReservedSlug("checkout")).toBe(true);
    expect(isReservedSlug("admin")).toBe(true);
    expect(isReservedSlug("CART")).toBe(true); // case insensitive
  });

  test("returns false for non-reserved", () => {
    expect(isReservedSlug("product")).toBe(false);
    expect(isReservedSlug("my-page")).toBe(false);
  });
});

describe("validateSlug", () => {
  test("valid slug passes", () => {
    expect(validateSlug("product-1")).toEqual({ valid: true });
    expect(validateSlug("محصول-تست")).toEqual({ valid: true });
    expect(validateSlug("p")).toEqual({ valid: true });
  });

  test("empty slug fails", () => {
    expect(validateSlug("")).toEqual({ valid: false, error: "اسلاگ خالی است" });
  });

  test("too long slug fails", () => {
    const long = "a".repeat(201);
    expect(validateSlug(long)).toEqual({ valid: false, error: "اسلاگ بسیار طولانی است (حداکثر ۲۰۰ کاراکتر)" });
  });

  test("reserved slug fails", () => {
    expect(validateSlug("cart")).toEqual({ valid: false, error: "این اسلاگ رزرو شده و قابل استفاده نیست" });
    expect(validateSlug("admin")).toEqual({ valid: false, error: "این اسلاگ رزرو شده و قابل استفاده نیست" });
  });

  test("invalid characters fail", () => {
    expect(validateSlug("product@")).toEqual({ valid: false, error: "اسلاگ شامل کاراکترهای غیرمجاز است" });
    expect(validateSlug("product_test")).toEqual({ valid: false, error: "اسلاگ شامل کاراکترهای غیرمجاز است" });
  });

  test("leading/trailing hyphen fails", () => {
    expect(validateSlug("-product")).toEqual({ valid: false, error: "اسلاگ نمی‌تواند با - شروع یا تمام شود" });
    expect(validateSlug("product-")).toEqual({ valid: false, error: "اسلاگ نمی‌تواند با - شروع یا تمام شود" });
  });

  test("double hyphen fails", () => {
    expect(validateSlug("product--test")).toEqual({ valid: false, error: "اسلاگ نمی‌تواند - تکراری داشته باشد" });
  });
});

describe("expandSearchQuery", () => {
  test("returns original query normalized", () => {
    const result = expandSearchQuery("سوتین");
    expect(result).toContain("سوتین");
  });

  test("expands with synonyms", () => {
    const result = expandSearchQuery("سوتین");
    expect(result).toContain("قف");
    expect(result).toContain("قف‌بندی");
  });

  test("handles ZWNJ in query", () => {
    const result = expandSearchQuery("بادی\u200Cسوت");
    expect(result).toContain("بادی سوت");
  });

  test("expands reverse synonyms", () => {
    const result = expandSearchQuery("قف");
    expect(result).toContain("سوتین");
  });

  test("multiple words", () => {
    const result = expandSearchQuery("سوتین شلوار");
    expect(result.length).toBeGreaterThan(1);
  });
});