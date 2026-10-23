/**
 * گام ۲۱ — صفحه‌های محتوایی در صفحه‌ساز.
 *
 * چه چیزی اینجا تست می‌شود (و چرا خطرناک است اگر نشکند):
 *  ۱) نشانه‌گذاریِ متنِ بلوک (`site-content/markup`) باید رفت‌وبرگشتِ بی‌ضرر
 *     داشته باشد — پیوند شماره تماس، برجسته، فهرست و یادداشت نباید در
 *     «محتوا → متن قابل ویرایش → محتوا» گم شوند.
 *  ۲) «ساخت صفحه از محتوای فعلی» باید صفحه‌ای بدون هیرو بسازد که متن و
 *     تیترهایش عیناً متنِ سایت است (شکایت اصلی: پنل با سایت فرق داشت).
 *  ۳) «بازسازی از محتوای فعلی» باید نسخهٔ قبل را نگه دارد، وضعیت انتشار را
 *     دست نزند و برای مسیرِ بی‌محتوا خطای روشن بدهد.
 *  ۴) فهرست‌های مرجع (پیشنهادی/ناوبری/قابل‌ویرایش) باید با مسیرهای واقعی
 *     سایت بخوانند — همان باگی که `terms` و `privacy` را از پنل جا انداخته بود.
 *
 * Prisma اینجا stub می‌شود (مثل phase17)؛ تست‌های DB-محور جدا هستند.
 */
import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { CmsService } from "../src/cms/cms.controller";
import {
  bodyToBlocks,
  CMS_BLOCK_DEFS,
  CMS_BLOCK_TYPES,
  CMS_SUGGESTED_PAGES,
  CONTENT_PAGE_NAV,
  LEGAL_PAGE_TITLES,
  linesToBody,
  makeBlock,
  normalizeCmsPage,
  parseBody,
  parseInline,
  sanitizeBlockProps,
  sectionToBody,
  SITE_CONTENT_PAGES,
  SITE_EDITABLE_PAGES,
  siteBlockText,
  siteContentToCmsPage,
  spansToText,
} from "@ghasedak/contracts";

/** stub حداقلیِ PrismaService — فقط متدهایی که CmsService لمس می‌کند */
function makePrisma(rows: Array<Record<string, any>> = []) {
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  return {
    cmsPage: {
      findMany: jest.fn().mockResolvedValue(rows),
      findUnique: jest.fn(({ where }: any) => bySlug.get(where.slug) ?? null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    contentRevision: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
}

function row(slug: string, payload: object, status: "DRAFT" | "PUBLISHED" = "DRAFT", published?: object) {
  return {
    slug,
    payload,
    publishedPayload: published ?? null,
    status,
    updatedAt: new Date("2026-10-01T10:00:00Z"),
    publishedAt: status === "PUBLISHED" ? new Date("2026-10-02T10:00:00Z") : null,
  };
}

/** فاصله‌ها یکی تا مقایسهٔ متن به تایپوگرافی گیر نکند */
const flatten = (s: string) => s.replace(/\s+/g, " ").trim();

const CONTENT_SLUGS = ["about", "contact", "returns", "shipping", "privacy", "terms"];

describe("Phase 21 — نشانه‌گذاری متن صفحه‌های محتوایی", () => {
  it("پیوند و برجسته با هم خوانده می‌شوند: [**متن**](لینک)", () => {
    const spans = parseInline("با شماره [**۰۹۳۶**](tel:+9893) تماس بگیرید.");
    expect(spans).toEqual([
      { text: "با شماره " },
      { text: "۰۹۳۶", href: "tel:+9893", strong: true },
      { text: " تماس بگیرید." },
    ]);
  });

  it("رفت‌وبرگشت پیوندها و برجسته‌ها بی‌ضرر است", () => {
    const samples = [
      "متن سادهٔ بدون نشانه",
      "پیش از [پیگیری مرسوله](/track) وارد شوید.",
      "**شعبه ۱:** عبدالمطلب ۱۵",
      "ایمیل: [info@lebaszirghasedak.ir](mailto:info@lebaszirghasedak.ir)",
      "[**@ghasedak_underwear**](https://instagram.com/ghasedak_underwear)",
    ];
    for (const s of samples) {
      expect(spansToText(parseInline(s))).toBe(s);
    }
  });

  it("هر خط یک بند است؛ - فهرست، > یادداشت، خط خالی بی‌اثر", () => {
    const lines = parseBody("بند اول\n\n- عضو یک\n- عضو دو\n> یادداشتِ کادردار\nبند دوم");
    expect(lines.map((l) => l.kind)).toEqual(["p", "li", "li", "note", "p"]);
    expect(linesToBody(lines)).toBe("بند اول\n- عضو یک\n- عضو دو\n> یادداشتِ کادردار\nبند دوم");
  });

  it("پیوند با پیشوند ناامن خوانده نمی‌شود — متنِ برچسب ساده می‌ماند", () => {
    // رندر این متن با `<a href>` انجام می‌شود؛ پس `javascript:` نباید هرگز
    // به href برسد. برچسب پیوند از بین نمی‌رود، فقط پیوند نمی‌شود.
    const spans = parseInline("[کلیک](javascript:alert)");
    expect(spans).toEqual([{ text: "کلیک" }]);
    // پیوندهای بی‌خطر (مسیر داخلی، تلفن، ایمیل، http) سالم می‌مانند
    expect(parseInline("[پیگیری](/track)")[0].href).toBe("/track");
    expect(parseInline("[ایمیل](mailto:x@y.ir)")[0].href).toBe("mailto:x@y.ir");
  });

  for (const slug of CONTENT_SLUGS) {
    it(`رفت‌وبرگشت کامل برای /${slug}: متن و شکل بندها دست‌نخورده می‌ماند`, () => {
      const page = SITE_CONTENT_PAGES[slug];
      expect(page).toBeDefined();
      for (const section of page.sections) {
        const back = bodyToBlocks(sectionToBody(section));
        // متنِ بندها (شامل اعضای فهرست) عیناً برمی‌گردد
        expect(flatten(back.map((b) => siteBlockText(b)).join("\n"))).toBe(
          flatten(section.blocks.map((b) => siteBlockText(b)).join("\n")),
        );
      }
    });
  }
});

describe("Phase 21 — بلوک CONTENT_PAGE", () => {
  it("تعریف بلوک سه فیلد دارد و متنِ راهنما نشانه‌گذاری را می‌گوید", () => {
    const def = CMS_BLOCK_DEFS.CONTENT_PAGE;
    expect(def.fields.map((f) => f.key)).toEqual(["intro", "updated", "sections"]);
    const sections = def.fields.find((f) => f.key === "sections");
    expect(sections?.type).toBe("list");
    expect(sections?.itemFields?.map((f) => f.key)).toEqual(["title", "body"]);
    expect(sections?.help).toContain("- ");
    expect(sections?.help).toContain("> ");
  });

  it("پاکسازی، کلیدهای ناشناخته را دور می‌ریزد و سقف‌ها را رعایت می‌کند", () => {
    const props = sanitizeBlockProps("CONTENT_PAGE", {
      intro: "معرفی",
      updated: "مهر ۱۴۰۵",
      evil: "<script>",
      sections: [
        { title: "تیتر", body: "بدنه", junk: 1 },
        ...Array.from({ length: 20 }, (_, i) => ({ title: `ب-${i}`, body: "x" })),
      ],
    });
    expect(props.evil).toBeUndefined();
    expect((props.sections as unknown[]).length).toBeLessThanOrEqual(16);
    const first = (props.sections as Array<Record<string, unknown>>)[0];
    expect(first).toEqual({ title: "تیتر", body: "بدنه" });
    // بدنهٔ بلندتر از سقف بریده می‌شود — سقف در تعریف بلوک است
    const long = sanitizeBlockProps("CONTENT_PAGE", { sections: [{ title: "", body: "x".repeat(5000) }] });
    expect((long.sections as Array<Record<string, string>>)[0].body.length).toBe(4000);
  });

  it("normalizeCmsPage بلوک CONTENT_PAGE را نگه می‌دارد و makeBlock مقادیر خالی می‌دهد", () => {
    const page = normalizeCmsPage({
      version: 1,
      title: "درباره ما",
      blocks: [{ type: "CONTENT_PAGE", props: { intro: "سلام", sections: [{ title: "تیتر", body: "متن" }] } }],
    });
    expect(page.blocks).toHaveLength(1);
    expect(page.blocks[0].type).toBe("CONTENT_PAGE");

    const fresh = makeBlock("CONTENT_PAGE");
    expect(fresh.props.sections).toEqual([]);
    expect(fresh.props.intro).toBe("");
  });

  it("همهٔ انواعِ بلوک تعریف و فیلدهایشان با مقادیر پیش‌فرض سازگار است", () => {
    for (const type of CMS_BLOCK_TYPES) {
      const def = CMS_BLOCK_DEFS[type];
      expect(def).toBeDefined();
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.fields.length).toBeGreaterThan(0);
      // مقادیر پیش‌فرض باید از همان پاک‌سازیِ API سالم رد شوند
      const cleaned = sanitizeBlockProps(type, def.defaults);
      expect(cleaned).toBeDefined();
    }
  });
});

describe("Phase 21 — تبدیل وفادانهٔ محتوا ↔ صفحهٔ صفحه‌ساز", () => {
  for (const slug of CONTENT_SLUGS) {
    it(`siteContentToCmsPage برای /${slug} فقط یک بلوک CONTENT_PAGE می‌سازد`, () => {
      const content = SITE_CONTENT_PAGES[slug];
      const page = siteContentToCmsPage(content, "عنوان مدیر");
      expect(page.blocks.map((b) => b.type)).toEqual(["CONTENT_PAGE"]);
      // سئوی پایه از معرفیِ صفحه می‌آید
      expect(page.seo?.description).toBe(content.intro ?? "");
    });
  }

  it("صفحه‌های خالی‌تیتر (تماس، یادداشت پایانی) بخشِ بدون تیتر می‌سازند", () => {
    const page = siteContentToCmsPage(SITE_CONTENT_PAGES.contact, "تماس با ما");
    const sections = (page.blocks[0].props.sections as Array<Record<string, unknown>>);
    const last = sections[sections.length - 1];
    expect(last.title).toBe("");
    // یادداشت با پیشوند `> ` ذخیره می‌شود تا در رندر کادر بماند
    expect(String(last.body)).toMatch(/^> /);
  });

  it("پیوندهای تماس/پیگیری در متن بلوک می‌مانند (گم نمی‌شوند)", () => {
    const bodyOf = (slug: string) =>
      (siteContentToCmsPage(SITE_CONTENT_PAGES[slug], "x").blocks[0].props.sections as Array<Record<string, string>>)
        .map((s) => s.body)
        .join("\n");

    const contact = bodyOf("contact");
    expect(contact).toContain("](tel:+989365226093)");
    expect(contact).toContain("](/order)");
    expect(contact).toContain("](/returns)");

    const shipping = bodyOf("shipping");
    expect(shipping).toContain("](/track)");
  });
});

describe("Phase 21 — بازسازی صفحهٔ محتوایی از متن مشترک (rebuildFromSite)", () => {
  const legacyHero = {
    version: 1,
    title: "دربارهٔ ما",
    seo: { title: "دربارهٔ ما", description: "" },
    blocks: [
      { type: "HERO", props: { title: "دربارهٔ ما", subtitle: "قدیمی" } },
      { type: "RICH_TEXT", props: { title: "متن", text: "متن پراکنده" } },
    ],
  };

  it("صفحهٔ قدیمی را بازسازی می‌کند: نسخهٔ قبل می‌ماند، وضعیت و عنوان دست‌نخورده", async () => {
    const prisma = makePrisma([row("about", legacyHero, "PUBLISHED", { version: 1, title: "x", blocks: [] })]);
    const svc = new CmsService(prisma as never);

    const out = await svc.rebuildFromSite("about", undefined, "u1");

    expect(out.created).toBe(false);
    expect(out.data.blocks.map((b) => b.type)).toEqual(["CONTENT_PAGE"]);
    // عنوانِ صفحه حفظ می‌شود — بازسازی کارِ متن است، نه نام‌گذاری
    expect(out.data.title).toBe("دربارهٔ ما");
    // نسخهٔ قبل در تاریخچه نوشته شد
    expect(prisma.contentRevision.create).toHaveBeenCalledTimes(1);
    // وضعیت انتشار در آپدیت نیامد → دست‌نخورده می‌ماند
    const upd = prisma.cmsPage.update.mock.calls[0][0].data;
    expect(upd.status).toBeUndefined();
    expect(upd.payload).toMatchObject({ version: 1 });
  });

  it("برای مسیر بدون صفحه، صفحهٔ پیش‌نویس می‌سازد (ارسال/بازگشت)", async () => {
    const prisma = makePrisma();
    const svc = new CmsService(prisma as never);

    const out = await svc.rebuildFromSite("shipping", undefined, "u1");

    expect(out.created).toBe(true);
    expect(out.data.title).toBe("روش‌های ارسال"); // عنوان از فهرست مرجع می‌آید
    expect(prisma.cmsPage.create).toHaveBeenCalledTimes(1);
    expect(prisma.contentRevision.create).not.toHaveBeenCalled();
  });

  it("برای مسیری که محتوای مشترک ندارد خطای روشن می‌دهد", async () => {
    const svc = new CmsService(makePrisma() as never);
    await expect(svc.rebuildFromSite("promo", undefined, "u1")).rejects.toThrow(BadRequestException);
  });

  it("slug نامعتبر رد می‌شود", async () => {
    const svc = new CmsService(makePrisma() as never);
    await expect(svc.rebuildFromSite("../etc", undefined, "u1")).rejects.toThrow(BadRequestException);
  });

  it("بازسازی‌شده منتشر می‌شود و همان بلوک محتوایی به عموم می‌رسد", async () => {
    const prisma = makePrisma([row("about", legacyHero, "DRAFT")]);
    const svc = new CmsService(prisma as never);

    await svc.rebuildFromSite("about", undefined, "u1");
    // stub ردیف را عوض نمی‌کند؛ payload بازسازی‌شده را برای publish شبیه‌سازی می‌کنیم
    const rebuilt = prisma.cmsPage.update.mock.calls[0][0].data.payload;
    prisma.cmsPage.findUnique.mockReturnValueOnce(Promise.resolve(row("about", rebuilt, "DRAFT")));

    await svc.publish("about", "u1");
    const snapshot = prisma.cmsPage.update.mock.calls[1][0].data.publishedPayload;
    expect(snapshot.blocks.map((b: { type: string }) => b.type)).toEqual(["CONTENT_PAGE"]);
  });
});

describe("Phase 21 — پرچم مدل قدیمی در «صفحات سایت»", () => {
  const legacyHero = {
    version: 1,
    title: "دربارهٔ ما",
    blocks: [{ type: "HERO", props: { title: "قدیمی" } }],
  };
  const modern = siteContentToCmsPage(SITE_CONTENT_PAGES.about, "دربارهٔ ما");

  it("صفحهٔ محتواییِ هیرو‌دار legacyModel دارد؛ با بلوک محتوایی ندارد", async () => {
    const legacy = new CmsService(makePrisma([row("about", legacyHero)]) as never);
    const { items: a } = await legacy.sitePages();
    expect(a.find((i) => i.path === "/about")?.cms?.legacyModel).toBe(true);

    const fresh = new CmsService(makePrisma([row("about", modern)]) as never);
    const { items: b } = await fresh.sitePages();
    expect(b.find((i) => i.path === "/about")?.cms?.legacyModel).toBe(false);
  });

  it("خانه و لندینگ سفارشی هرگز legacyModel ندارند", async () => {
    const svc = new CmsService(
      makePrisma([row("home", legacyHero), row("spring-sale", legacyHero)]) as never,
    );
    const { items } = await svc.sitePages();
    expect(items.find((i) => i.slug === "home")?.cms?.legacyModel).toBe(false);
    expect(items.find((i) => i.slug === "spring-sale")?.cms?.legacyModel).toBe(false);
  });

  it("صفحهٔ ساخته‌نشده cms:null است — پرچمی هم ندارد", async () => {
    const svc = new CmsService(makePrisma() as never);
    const { items } = await svc.sitePages();
    expect(items.find((i) => i.path === "/shipping")?.cms).toBeNull();
  });
});

describe("Phase 21 — هم‌راستایی فهرست‌های مرجع با مسیرهای واقعی", () => {
  it("CMS_SUGGESTED_PAGES دقیقاً مسیرهای قابل‌ویرایش سایت است — terms و privacy جا نمانده", () => {
    const suggested = CMS_SUGGESTED_PAGES.map((p) => p.slug).sort();
    const editable = SITE_EDITABLE_PAGES.map((p) => p.slug as string).sort();
    expect(suggested).toEqual(editable);
    // همان باگ قدیمی: دو صفحهٔ واقعی از پنل افتاده بودند
    expect(suggested).toContain("terms");
    expect(suggested).toContain("privacy");
    expect(suggested).toContain("shipping");
    expect(suggested).toContain("returns");
  });

  it("هر شش مسیر محتوایی، مسیر قابل‌ویرایش با همان slug دارد", () => {
    for (const slug of CONTENT_SLUGS) {
      const def = SITE_EDITABLE_PAGES.find((p) => p.slug === slug);
      expect(def).toBeDefined();
      expect(def?.editable).toBe(true);
    }
  });

  it("نوار پیمایش صفحه‌های محتوایی همان شش صفحه با برچسبِ ثابت است", () => {
    expect(CONTENT_PAGE_NAV.map((n) => n.slug).sort()).toEqual([...CONTENT_SLUGS].sort());
    for (const n of CONTENT_PAGE_NAV) {
      expect(n.title).toBe(LEGAL_PAGE_TITLES[n.slug as keyof typeof LEGAL_PAGE_TITLES]);
      expect(n.href).toBe(`/${n.slug}`);
    }
  });
});
