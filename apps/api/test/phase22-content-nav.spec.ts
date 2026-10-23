/**
 * گام ۲۲ — ناوبریِ صفحه‌های محتوایی قابل‌ویرایش از پنل (نام/ترتیب/پنهان‌سازی).
 *
 * چه چیزی اینجا تست می‌شود (و چرا خطرناک است اگر نشکند):
 *  ۱) ناوبری پیش از این در کد ثابت بود؛ حالا از `Setting` می‌آید. اگر خواندنِ
 *     ذخیره بی‌دفاع باشد، یک مقدار خراب می‌تواند نوارِ شش صفحهٔ سایت را خالی
 *     کند — یعنی صفحه‌های حقوقی از هم پیوند بخورند.
 *  ۲) «حذف» باید یعنی پنهان‌سازی، نه حذفِ صفحه: صفحه هست و از آدرس باز
 *     می‌شود، فقط از نوار پیوندش نیست. گزینهٔ جامانده باید به پیش‌فرض برگردد،
 *     نه اینکه گم شود.
 *  ۳) `href` باید همیشه از فهرستِ ثابت بیاید — مدیر مسیر را عوض نمی‌کند، وگرنه
 *     پیوندِ شکسته در سایت ممکن می‌شود.
 *  ۴) نوشتن سخت‌گیرانه باشد (خطا به چشم مدیر بیاید) ولی خواندن دفاعی.
 *
 * Prisma اینجا stub می‌شود (مثل phase17/21)؛ تست‌های DB-محور جدا هستند.
 */
import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { CmsAdminController, CmsService } from "../src/cms/cms.controller";
import { PublicThemeController } from "../src/admin/public-theme.controller";
import {
  CONTENT_NAV_SETTING_KEY,
  CONTENT_NAV_TITLE_MAX,
  CONTENT_PAGE_NAV,
  LEGAL_PAGE_TITLES,
  normalizeContentNavInput,
  resolveContentNav,
  resolveContentNavAll,
} from "@ghasedak/contracts";

/** stub حداقلیِ PrismaService — فقط `setting` و `auditLog` که ناوبری لمس می‌کند */
function makePrisma(initial: { value: unknown } | null = null) {
  const state = { row: initial as { value: unknown } | null };
  const prisma = {
    setting: {
      findUnique: jest.fn(async () => state.row),
      upsert: jest.fn(async (args: { create: { key: string; value: unknown } }) => {
        state.row = { value: args.create.value };
        return state.row;
      }),
    },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  return { prisma: prisma as any, state };
}

const defaultSlugs = CONTENT_PAGE_NAV.map((n) => n.slug);

describe("Phase 22 — ناوبری صفحه‌های محتوایی", () => {
  /* ── قرارداد: خواندنِ ذخیره (دفاعی) ── */
  describe("resolveContentNav — خواندن", () => {
    it("بدون تنظیم، همان شش صفحه با ترتیب و برچسبِ پیش‌فرض است", () => {
      for (const config of [null, undefined, "junk", 42, {}, { items: "nope" }, []]) {
        expect(resolveContentNav(config).map((n) => n.slug)).toEqual(defaultSlugs);
      }
      expect(resolveContentNav(null)).toEqual([...CONTENT_PAGE_NAV]);
    });

    it("نام عوض می‌شود ولی href از فهرستِ ثابت می‌آید — پیوندِ دلخواه پذیرفته نمی‌شود", () => {
      const items = resolveContentNav({
        items: [{ slug: "about", title: "دربارهٔ قاصدک", href: "/javascript:alert(1)" }],
      });
      const about = items.find((n) => n.slug === "about");
      expect(about?.title).toBe("دربارهٔ قاصدک");
      expect(about?.href).toBe("/about");
    });

    it("ترتیبِ ذخیره‌شده اجرا می‌شود و گزینهٔ جامانده به آخر می‌رود", () => {
      const items = resolveContentNav({ items: [{ slug: "contact" }, { slug: "terms" }] });
      expect(items.map((n) => n.slug).slice(0, 2)).toEqual(["contact", "terms"]);
      // بقیه به ترتیبِ پیش‌فرض، بدون اینکه جا بمانند
      expect([...items.map((n) => n.slug)].sort()).toEqual([...defaultSlugs].sort());
    });

    it("پنهان از نمایش بیرون است ولی در فهرستِ کامل (پنل) می‌ماند", () => {
      const config = { items: [{ slug: "privacy", visible: false }] };
      expect(resolveContentNav(config).map((n) => n.slug)).not.toContain("privacy");
      const all = resolveContentNavAll(config);
      // گزینهٔ ذخیره‌شده جلو می‌آید (ترتیبِ ذخیره فرمان می‌دهد) و پنهان همچنان
      // در فهرست پنل هست تا دکمهٔ «نمایش» بتواند برگرداندش
      expect(all.map((n) => n.slug)).toEqual(["privacy", ...defaultSlugs.filter((s) => s !== "privacy")]);
      expect(all.find((n) => n.slug === "privacy")?.visible).toBe(false);
      // بقیه نمایان‌اند
      expect(all.filter((n) => n.slug !== "privacy").every((n) => n.visible)).toBe(true);
    });

    it("slug ناشناخته و تکراری هرگز به رندر نمی‌رسد (اولینِ فهرست برنده)", () => {
      const items = resolveContentNav({
        items: [
          { slug: "../../etc", title: "بد" },
          { slug: "about", title: "اول" },
          { slug: "about", title: "دوم" },
        ],
      });
      expect(items.find((n) => n.slug === "about")?.title).toBe("اول");
      expect(items.some((n) => n.title === "بد")).toBe(false);
      expect(items).toHaveLength(6);
    });

    it("پنهان‌سازیِ همه یعنی نوار خالی — نه نوارِ پیش‌فرض", () => {
      const all = resolveContentNavAll({ items: defaultSlugs.map((slug) => ({ slug, visible: false })) });
      expect(resolveContentNav({ items: all })).toEqual([]);
    });
  });

  /* ── قرارداد: نوشتن (سخت‌گیرانه) ── */
  describe("normalizeContentNavInput — ورودی پنل", () => {
    it("برچسبِ پیش‌فرض و «نمایان» حذف می‌شوند — ذخیره کوچک می‌ماند", () => {
      const out = normalizeContentNavInput(
        CONTENT_PAGE_NAV.map((n) => ({ ...n, visible: true })),
      );
      expect("items" in out).toBe(true);
      if ("items" in out) expect(out.items).toEqual(defaultSlugs.map((slug) => ({ slug })));
    });

    it("نامِ سفارشی، ترتیب و پنهان‌سازی همان‌طور که پنل فرستاد می‌ماند", () => {
      const out = normalizeContentNavInput([
        { slug: "contact", title: "  با ما تماس بگیرید  " },
        { slug: "terms", visible: false },
        { slug: "about" },
      ]);
      expect("items" in out).toBe(true);
      if ("items" in out) {
        expect(out.items).toEqual([
          { slug: "contact", title: "با ما تماس بگیرید" },
          { slug: "terms", visible: false },
          { slug: "about" },
        ]);
      }
      // و همان ورودی بعد از خواندن، ترتیب را می‌سازد: ذخیره‌شده‌ها جلو (به
      // همان ترتیب)، بقیه به ترتیبِ پیش‌فرض — پنهان هم فیلتر می‌شود
      const items = resolveContentNav("items" in out ? out.items : null);
      expect(items.map((n) => n.slug)).toEqual(["contact", "about", "returns", "shipping", "privacy"]);
    });

    it("لیستِ ناقص معتبر است — گزینهٔ جامانده به پیش‌فرض برمی‌گردد", () => {
      const out = normalizeContentNavInput([{ slug: "shipping" }]);
      expect("items" in out && out.items).toEqual([{ slug: "shipping" }]);
      expect(resolveContentNav("items" in out ? out.items : null)).toHaveLength(6);
    });

    it.each([
      ["غیر آرایه", "not-an-array"],
      ["شیء به‌جای آرایه", { items: [] }],
      ["slug ناشناخته", [{ slug: "home" }]],
      ["تکرار", [{ slug: "about" }, { slug: "about" }]],
      ["عنوانِ بلندتر از حد", [{ slug: "about", title: "ن".repeat(CONTENT_NAV_TITLE_MAX + 1) }]],
      ["عنوانِ غیرمتنی", [{ slug: "about", title: 7 }]],
      ["visibleِ غیر boolean", [{ slug: "about", visible: "yes" }]],
      ["عضوِ غیرشیء", ["about"]],
    ])("خطا: %s", (_label, input) => {
      const out = normalizeContentNavInput(input);
      expect("error" in out).toBe(true);
      if ("error" in out) expect(out.error.length).toBeGreaterThan(4);
    });

    it("پیامِ خطا شناسهٔ گناهکار را می‌گوید تا مدیر بفهمد چه فرستاده", () => {
      const out = normalizeContentNavInput([{ slug: "nope" }]);
      expect("error" in out && out.error).toContain("nope");
    });
  });

  /* ── کنترلر ادمین ── */
  describe("CmsAdminController — GET/PUT content-nav", () => {
    it("GET لیست کامل (شامل پنهان‌ها) برمی‌گرداند — بدون تنظیم، همان پیش‌فرض", async () => {
      const { prisma } = makePrisma(null);
      const ctrl = new CmsAdminController(new CmsService(prisma));
      const res = await ctrl.contentNav();
      expect(res.items).toHaveLength(6);
      expect(res.items.map((i: { slug: string }) => i.slug)).toEqual(defaultSlugs);
      expect(res.items.every((i: { visible: boolean }) => i.visible)).toBe(true);
      expect(res.items[0].href).toBe("/about");
      expect(res.items[0].title).toBe(LEGAL_PAGE_TITLES.about);
    });

    it("PUT معتبر ذخیره می‌کند، audit می‌زند و همان را برمی‌گرداند", async () => {
      const { prisma, state } = makePrisma(null);
      const ctrl = new CmsAdminController(new CmsService(prisma));
      const saved = await ctrl.saveContentNav(
        { items: [{ slug: "contact", title: "تماس" }, { slug: "returns", visible: false }] },
        { userId: "u1" } as any,
      );
      expect(state.row?.value).toEqual({
        items: [{ slug: "contact", title: "تماس" }, { slug: "returns", visible: false }],
      });
      expect(prisma.setting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: CONTENT_NAV_SETTING_KEY } }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: "contentNav.save" }) }),
      );
      expect(saved.items.map((i: { slug: string }) => i.slug)).toEqual([
        "contact",
        "returns", // ذخیره‌نشده → به ترتیبِ پیش‌فرض، بعد از ذخیره‌شده‌ها
        "about",
        "shipping",
        "terms",
        "privacy",
      ]);
      expect(saved.items.find((i: { slug: string }) => i.slug === "returns")?.visible).toBe(false);

      // و GET همان چیزی را می‌دهد که PUT نوشت
      const reread = await ctrl.contentNav();
      expect(reread).toEqual(saved);
    });

    it("PUT نامعتبر خطا می‌دهد و چیزی ذخیره نمی‌کند", async () => {
      const { prisma } = makePrisma(null);
      const ctrl = new CmsAdminController(new CmsService(prisma));
      await expect(
        ctrl.saveContentNav({ items: [{ slug: "hacker" }] }, null),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.setting.upsert).not.toHaveBeenCalled();
    });
  });

  /* ── کنترلر عمومی (فروشگاه) ── */
  describe("PublicThemeController — content-nav عمومی", () => {
    it("فقط گزینه‌های نمایان را می‌دهد و چیز داخلی‌ای در آن نیست", async () => {
      const { prisma } = makePrisma({
        value: { items: [{ slug: "terms", title: "قوانین" }, { slug: "about", visible: false }] },
      });
      const ctrl = new PublicThemeController(prisma);
      const res = await ctrl.contentNav();
      expect(res.items.map((i: { slug: string }) => i.slug)).toEqual([
        "terms",
        "returns",
        "shipping",
        "privacy",
        "contact",
      ]);
      expect(res.items.find((i: { slug: string }) => i.slug === "terms")?.title).toBe("قوانین");
      expect(Object.keys(res.items[0]).sort()).toEqual(["href", "slug", "title"]);
      expect(prisma.setting.findUnique).toHaveBeenCalledWith({ where: { key: CONTENT_NAV_SETTING_KEY } });
    });

    it("تنظیم نبود → پیش‌فرضِ قرارداد (قطعیِ پنل نباید نوار را جا بیندازد)", async () => {
      const { prisma } = makePrisma(null);
      const ctrl = new PublicThemeController(prisma);
      const res = await ctrl.contentNav();
      expect(res.items).toEqual([...CONTENT_PAGE_NAV]);
    });
  });
});
