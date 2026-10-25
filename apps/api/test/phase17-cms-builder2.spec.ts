/**
 * گام ۱۷ — صفحه‌ساز بصری ۲.۰: تست endpointهای جدید بدون DB.
 *
 * چرا بدون DB: دو رفتارِ خطرناکِ این گام منطقِ محض‌اند و اگر خراب شوند
 * مدیر را گمراه می‌کنند:
 *  ۱) «صفحات سایت» باید مسیرهای مرجع (SITE_PAGES) و صفحه‌های ساخته‌شده را
 *     درست کنار هم بگذارد — وگرنه مدیر مسیرِ واقعی سایت را نمی‌بیند یا
 *     لندینگ سفارشی گم می‌شود.
 *  ۲) پیش‌نمایش عمومی (`cms/page/:slug?preview=1`) باید پیش‌نویس را فقط
 *     به نشست ادمینِ مجاز بدهد — نشت پیش‌نویس به عموم یعنی انتشار ناخواسته.
 * Prisma اینجا stub می‌شود؛ تست‌های DB-محورِ ماژول از قبل پوشش داده شده‌اند.
 */
import "reflect-metadata";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { CmsService } from "../src/cms/cms.controller";
import {
  ART_FRAME_COLORS,
  ART_FRAME_DEFAULTS,
  ART_FRAME_NOTES,
  SITE_PAGES,
  contentPageToSiteContent,
  normalizeCmsPage,
  resolveArtFrames,
  sanitizeBlockProps,
  siteBlockText,
  siteContentBySlug,
  sitePathForSlug,
} from "@ghasedak/contracts";
import type { AdminIdentity } from "../src/auth/auth.service";

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

function row(slug: string, payload: object, status: "DRAFT" | "PUBLISHED", published?: object) {
  return {
    slug,
    payload,
    /** اسنپ‌شات منتشرشده — اگر داده نشود به‌معنی «هرگز از این نسخه منتشر نشده» است */
    publishedPayload: published ?? null,
    status,
    updatedAt: new Date("2026-10-01T10:00:00Z"),
    publishedAt: status === "PUBLISHED" ? new Date("2026-10-02T10:00:00Z") : null,
  };
}

const heroPage = {
  version: 1,
  title: "دربارهٔ ما",
  seo: { title: "دربارهٔ ما", description: "" },
  blocks: [{ type: "HERO", props: { title: "سلام" } }],
};

const admin: AdminIdentity = { userId: "u1", permissions: ["marketing.view"] } as unknown as AdminIdentity;
const superAdmin: AdminIdentity = { userId: "u2", permissions: ["*"] } as unknown as AdminIdentity;

describe("Phase 17 — CmsService.sitePages()", () => {
  it("بدون هیچ صفحهٔ ساخته‌شده، همهٔ مسیرهای مرجع با cms:null برمی‌گردند", async () => {
    const svc = new CmsService(makePrisma() as never);
    const { items } = await svc.sitePages();

    expect(items).toHaveLength(SITE_PAGES.length);
    for (const def of SITE_PAGES) {
      const it = items.find((i) => i.path === def.path);
      expect(it).toBeDefined();
      expect(it?.slug).toBe(def.slug);
      expect(it?.kind).toBe(def.kind);
      expect(it?.editable).toBe(def.editable);
      expect(it?.cms).toBeNull();
    }
  });

  it("صفحهٔ ساخته‌شده با slugِ مسیر مرجع، وضعیتش به همان مسیر می‌چسبد", async () => {
    const svc = new CmsService(makePrisma([row("about", heroPage, "PUBLISHED")]) as never);
    const { items } = await svc.sitePages();

    const about = items.find((i) => i.path === "/about");
    expect(about?.cms).toMatchObject({ status: "PUBLISHED", blockCount: 1 });
    // بقیهٔ مسیرها همچنان بدون وضعیت‌اند
    expect(items.find((i) => i.path === "/contact")?.cms).toBeNull();
    // تعداد کل = مرجع + هیچ لندینگ اضافه‌ای
    expect(items).toHaveLength(SITE_PAGES.length);
  });

  it("لندینگ سفارشی (slug خارج از مرجع) به‌صورت kind=CMS با مسیر درست اضافه می‌شود", async () => {
    const svc = new CmsService(makePrisma([row("spring-sale", heroPage, "DRAFT")]) as never);
    const { items } = await svc.sitePages();

    expect(items).toHaveLength(SITE_PAGES.length + 1);
    const custom = items.find((i) => i.slug === "spring-sale");
    expect(custom).toBeDefined();
    expect(custom?.path).toBe(sitePathForSlug("spring-sale"));
    expect(custom?.kind).toBe("CMS");
    expect(custom?.editable).toBe(true);
    expect(custom?.cms).toMatchObject({ status: "DRAFT", blockCount: 1 });
  });

  it("home روی مسیر «/» می‌نشیند نه «/home»", async () => {
    const svc = new CmsService(makePrisma([row("home", heroPage, "PUBLISHED")]) as never);
    const { items } = await svc.sitePages();

    const home = items.find((i) => i.slug === "home");
    expect(home?.path).toBe("/");
    expect(home?.cms).toMatchObject({ status: "PUBLISHED" });
  });
});

describe("Phase 17 — CmsService.getPublic() (پیش‌نمایش امن)", () => {
  it("صفحهٔ ناموجود → null", async () => {
    const svc = new CmsService(makePrisma() as never);
    expect(await svc.getPublic("ghost", false, null)).toBeNull();
  });

  it("پیش‌نویس برای عموم (بدون preview/بدون نشست) → null", async () => {
    const svc = new CmsService(makePrisma([row("about", heroPage, "DRAFT")]) as never);
    expect(await svc.getPublic("about", false, null)).toBeNull();
    // حتی با preview=1، بدون نشست ادمین چیزی برنمی‌گردد
    expect(await svc.getPublic("about", true, null)).toBeNull();
  });

  it("پیش‌نمایش پیش‌نویس فقط با نشست ادمینِ مجاز (marketing.view یا *)", async () => {
    const svc = new CmsService(makePrisma([row("about", heroPage, "DRAFT")]) as never);

    const withView = await svc.getPublic("about", true, admin);
    expect(withView).toMatchObject({ slug: "about", status: "DRAFT", preview: true });

    const withStar = await svc.getPublic("about", true, superAdmin);
    expect(withStar?.preview).toBe(true);

    // بدون مجوز مارکتینگ → انگار preview وجود ندارد
    const otherRole = { userId: "u3", permissions: ["orders.view"] } as unknown as AdminIdentity;
    expect(await svc.getPublic("about", true, otherRole)).toBeNull();
  });

  it("صفحهٔ منتشرشده برای همه (حتی بدون نشست) خوانده می‌شود", async () => {
    const svc = new CmsService(makePrisma([row("about", heroPage, "PUBLISHED")]) as never);
    const out = await svc.getPublic("about", false, null);
    expect(out).toMatchObject({ slug: "about", status: "PUBLISHED", preview: false });
  });
});

describe("Phase 17 — پیش‌نویس ≠ منتشرشده", () => {
  /** پیش‌نویس تازه‌تر از نسخهٔ منتشرشده — همان چیزی که بعد از «ذخیره» روی صفحهٔ منتشرشده پیش می‌آید */
  const draftPage = {
    version: 1,
    title: "دربارهٔ ما",
    seo: { title: "دربارهٔ ما", description: "" },
    blocks: [{ type: "HERO", props: { title: "نسخهٔ پیش‌نویس" } }],
  };
  const livePage = {
    version: 1,
    title: "دربارهٔ ما",
    seo: { title: "دربارهٔ ما", description: "" },
    blocks: [{ type: "HERO", props: { title: "نسخهٔ منتشرشده" } }],
  };

  it("ذخیره روی صفحهٔ منتشرشده، سایت را عوض نمی‌کند — عموم اسنپ‌شات را می‌بیند", async () => {
    const svc = new CmsService(makePrisma([row("about", draftPage, "PUBLISHED", livePage)]) as never);
    const out = await svc.getPublic("about", false, null);

    expect(out?.data.blocks[0].props).toMatchObject({ title: "نسخهٔ منتشرشده" });
    expect(out?.preview).toBe(false);
  });

  it("بوم پنل (preview با ادمین مجاز) همان پیش‌نویس را می‌بیند", async () => {
    const svc = new CmsService(makePrisma([row("about", draftPage, "PUBLISHED", livePage)]) as never);
    const out = await svc.getPublic("about", true, admin);

    expect(out?.data.blocks[0].props).toMatchObject({ title: "نسخهٔ پیش‌نویس" });
    expect(out?.preview).toBe(true);
  });

  it("پنل می‌فهمد پیش‌نویس منتشرنشده دارد (hasUnpublishedChanges)", async () => {
    const dirty = new CmsService(makePrisma([row("about", draftPage, "PUBLISHED", livePage)]) as never);
    expect((await dirty.get("about")).hasUnpublishedChanges).toBe(true);

    const clean = new CmsService(makePrisma([row("about", livePage, "PUBLISHED", livePage)]) as never);
    expect((await clean.get("about")).hasUnpublishedChanges).toBe(false);
  });

  it("page منتشرشده‌ای که اسنپ‌شات ندارد (صفحه‌های قدیمی) با payload سرو می‌شود", async () => {
    const svc = new CmsService(makePrisma([row("about", livePage, "PUBLISHED")]) as never);

    const out = await svc.getPublic("about", false, null);
    expect(out?.data.blocks[0].props).toMatchObject({ title: "نسخهٔ منتشرشده" });
    // اسنپ‌شات ندارد → چیزی برای مقایسه نیست، پس «تغییر منتشرنشده» هم نمی‌سازیم
    expect((await svc.get("about")).hasUnpublishedChanges).toBe(false);
  });

  it("انتشار، اسنپ‌شات را از پیش‌نویس می‌سازد", async () => {
    const prisma = makePrisma([row("about", draftPage, "DRAFT")]);
    const svc = new CmsService(prisma as never);

    await svc.publish("about", "u1");

    const data = prisma.cmsPage.update.mock.calls[0][0].data;
    expect(data.status).toBe("PUBLISHED");
    expect(data.publishedPayload).toMatchObject({ title: "دربارهٔ ما" });
    expect(data.publishedPayload.blocks[0].props.title).toBe("نسخهٔ پیش‌نویس");
  });

  it("فهرست «صفحات سایت» تغییر منتشرنشده را هم نشان می‌دهد", async () => {
    const svc = new CmsService(makePrisma([row("about", draftPage, "PUBLISHED", livePage)]) as never);
    const { items } = await svc.sitePages();

    expect(items.find((i) => i.path === "/about")?.cms?.hasUnpublishedChanges).toBe(true);
    expect(items.find((i) => i.path === "/contact")?.cms).toBeNull();
  });
});

describe("Phase 17 — الگوهای شروع صفحه", () => {
  it("ساخت صفحه با starter=landing شش بلوک آماده می‌سازد", async () => {
    const svc = new CmsService(makePrisma() as never);
    const { data } = await svc.create("promo", "کمپین بهار", "landing", "u1");
    expect(data.blocks.length).toBe(6);
    expect(data.blocks.map((b) => b.type)).toContain("HERO");
    // قفسهٔ آرت بلافاصله بعد از هیرو می‌نشیند — پل بین قاب هیرو و کارت محصول
    expect(data.blocks.map((b) => b.type)).toContain("ART_SHOWCASE");
    expect(data.blocks.map((b) => b.type)).toContain("CATEGORY_GRID");
    expect(data.blocks[1].type).toBe("ART_SHOWCASE");
  });

  it("ساخت صفحه با starter=simple یک هیرو و یک متن می‌سازد (بومِ خالی ممنوع)", async () => {
    const svc = new CmsService(makePrisma() as never);
    const { data } = await svc.create("about", "دربارهٔ ما", "simple", "u1");
    expect(data.blocks.map((b) => b.type)).toEqual(["HERO", "RICH_TEXT"]);
    // عنوانِ متن به‌روشنی راهنمای ویرایش است، نه محتوای نهایی
    expect(String((data.blocks[1].props as Record<string, unknown>).text)).toContain("اینجا");
  });

  it("ساخت صفحه با starter=empty واقعاً خالی است", async () => {
    const svc = new CmsService(makePrisma() as never);
    const { data } = await svc.create("blank", "خالی", "empty", "u1");
    expect(data.blocks).toHaveLength(0);
  });

  it("ساخت صفحهٔ تکراری رد می‌شود (409 — تصمیم گام ۲۰: تکرارِ شناسهٔ دستی صریح و فارسی)", async () => {
    const svc = new CmsService(makePrisma([row("about", heroPage, "DRAFT")]) as never);
    await expect(svc.create("about", "دوباره", "simple", "u1")).rejects.toThrow(ConflictException);
    await svc.create("about", "دوباره", "simple", "u1").catch((e: unknown) => {
      expect((e as { getResponse?: () => unknown }).getResponse?.()).toMatchObject({
        code: "PAGE_EXISTS",
        message: "صفحه‌ای با این شناسه از قبل وجود دارد.",
      });
    });
  });
});

describe("Phase 17 — ساخت صفحه از محتوای فعلی سایت (starter=site)", () => {
  /** فاصله‌ها یکی می‌شود تا مقایسهٔ متن به تفاوتِ تایپوگرافی گیر نکند */
  const flatten = (s: string) => s.replace(/\s+/g, " ").trim();

  /** متنِ یک صفحهٔ محتوایی — تیترها + بندها، برای مقایسهٔ دوطرفه */
  const plain = (p: { sections: Array<{ title?: string; blocks: object[] }> }): string =>
    flatten(
      p.sections
        .map((s) => `${s.title ?? ""}\n${s.blocks.map((b) => siteBlockText(b as never)).join("\n")}`)
        .join("\n"),
    );

  for (const slug of ["about", "contact", "returns", "shipping", "privacy", "terms"]) {
    it(`starter=site برای /${slug} یک بلوک «صفحهٔ محتوایی» می‌سازد — بدون هیرو`, async () => {
      const svc = new CmsService(makePrisma() as never);
      const { data } = await svc.create(slug, "عنوان صفحه", "site", "u1");

      // صفحهٔ محتوایی در سایت هیرو ندارد؛ صفحه‌ساز هم نباید بسازد —
      // وگرنه صفحهٔ پنل با صفحهٔ واقعی سایت یک شکل نبود (شکایت اصلی).
      expect(data.blocks.map((b) => b.type)).toEqual(["CONTENT_PAGE"]);
      expect(data.title).toBe("عنوان صفحه");

      const content = siteContentBySlug(slug);
      expect(content).toBeDefined();
      // متن و تیترها بی‌کم‌و‌اضافه می‌آیند — با بازگشت به مدلِ غنی مقایسه می‌شود
      const built = contentPageToSiteContent(data);
      expect(built).toBeDefined();
      expect(plain(built!)).toBe(plain(content!));
      // پاراگراف معرفی و تاریخ به‌روزرسانی هم حفظ می‌شوند
      expect(built?.intro).toBe(content!.intro);
      expect(built?.updated).toBe(content!.updated);
    });
  }

  it("starter=site برای مسیری که محتوای مشترک ندارد، بومِ خالی نمی‌سازد", async () => {
    const svc = new CmsService(makePrisma() as never);
    const { data } = await svc.create("promo", "کمپین بهار", "site", "u1");
    expect(data.blocks.length).toBeGreaterThan(0);
    expect(data.blocks.map((b) => b.type)).toContain("RICH_TEXT");
  });

  it("starter=site برای خانه، چیدمان فروشگاهی می‌دهد", async () => {
    const svc = new CmsService(makePrisma() as never);
    const { data } = await svc.create("home", "صفحهٔ اصلی", "site", "u1");
    expect(data.blocks.length).toBeGreaterThan(1);
  });
});

describe("Phase 17 — فیلدهای قاب عکس هیرو", () => {
  it("imageFocus فقط مقادیر مجاز را نگه می‌دارد", () => {
    expect(sanitizeBlockProps("HERO", { imageFocus: "top" }).imageFocus).toBe("top");
    expect(sanitizeBlockProps("HERO", { imageFocus: "bottom" }).imageFocus).toBe("bottom");
    // مقدار ناشناخته → پیش‌فرض وسط؛ وگرنه عکس بی‌دلیل جابه‌جا می‌شد
    expect(sanitizeBlockProps("HERO", { imageFocus: "left" }).imageFocus).toBe("center");
  });

  it("مسیر رسانه مجاز است ولی javascript: پاک می‌شود", () => {
    const media = sanitizeBlockProps("HERO", { imageUrl: "/api/media/x.jpg" });
    expect(media.imageUrl).toBe("/api/media/x.jpg");
    expect(sanitizeBlockProps("HERO", { imageUrl: "javascript:alert(1)" }).imageUrl).toBe("");
  });

  it("متن جایگزین عکس پیش‌فرض ندارد و متن واقعی را نگه می‌دارد", () => {
    expect(sanitizeBlockProps("HERO", {}).imageAlt).toBeUndefined();
    expect(sanitizeBlockProps("HERO", { imageAlt: "ست نخی" }).imageAlt).toBe("ست نخی");
  });
});

describe("Phase 17 — قفسهٔ آرت: ترتیب و رنگِ مدیر", () => {
  /** یک سطر قاب از دادهٔ مدیر */
  const frame = (kind: string, color: string, label = "") => ({ kind, color, label });

  it("پاکسازی، ترتیب مدیر را نگه می‌دارد و رنگِ بیرون از پالت را دور می‌ریزد", () => {
    const props = sanitizeBlockProps("ART_SHOWCASE", {
      frames: [
        frame("sport", "sage", "ورزشی"),
        frame("set", "#ff0000", "ست"),
        frame("bra", "primary"),
      ],
    });
    const rows = props.frames as Array<Record<string, string>>;

    // ترتیب دست‌نخورده می‌ماند — همین چیزی است که مدیر با ↑ و ↓ می‌خواهد
    expect(rows.map((r) => r.kind)).toEqual(["sport", "set", "bra"]);
    // رنگِ hex آزاد در پالت برند نیست و دور ریخته می‌شود
    expect(rows[1].color).toBe("");
    expect(rows[0].color).toBe("sage");
    // برچسبِ مدیر می‌ماند (خالی = نام دستهٔ زنده)
    expect(rows[0].label).toBe("ورزشی");
  });

  it("قفسه بیش از شش سطر ندارد — شکلِ قفسه ثابتِ برند است", () => {
    const rows = Array.from({ length: 9 }, (_, i) => frame("bra", "primary", `ب-${i}`));
    const props = sanitizeBlockProps("ART_SHOWCASE", { frames: rows });
    expect((props.frames as unknown[]).length).toBe(6);
  });

  it("قفسه همیشه شش فرمِ برند است — فرمِ تکراری یا ناشناخته حذف و جای خالی پر می‌شود", () => {
    const frames = resolveArtFrames([
      frame("bra", "primary"),
      frame("bra", "sage"), // تکراری
      frame("unicorn", "primary"), // ناشناخته
    ]);

    expect(frames).toHaveLength(6);
    // فرمِ تکراری و ناشناخته جایگزین نمی‌شوند؛ قفسه با فرم‌های برند پر می‌شود
    expect(frames.map((f) => f.kind)).toEqual([
      "bra",
      "set",
      "panty",
      "shapewear",
      "sport",
      "sleepwear",
    ]);
  });

  it("رنگِ نامعتبر به رنگ پیش‌فرض همان فرم برمی‌گردد (نه به رنگ قابِ اول)", () => {
    const [bra] = resolveArtFrames([frame("bra", "#123456")]);
    const braDefault = ART_FRAME_COLORS.find((c) => c.value === ART_FRAME_DEFAULTS[1].color);
    expect(bra.color).toBe(braDefault?.cssVar);
  });

  it("ترتیب مدیر در صفحهٔ نرمال‌شده هم می‌ماند", () => {
    const page = normalizeCmsPage({
      version: 1,
      title: "خانه",
      blocks: [
        {
          type: "ART_SHOWCASE",
          props: {
            frames: [
              frame("sleepwear", "dusty-rose"),
              frame("shapewear", "plum"),
              frame("panty", "sage"),
              frame("bra", "primary"),
              frame("set", "dusty-rose"),
              frame("sport", "primary"),
            ],
          },
        },
      ],
    });

    const rows = (page.blocks[0].props as { frames: Array<Record<string, string>> }).frames;
    expect(rows.map((r) => r.kind)).toEqual([
      "sleepwear",
      "shapewear",
      "panty",
      "bra",
      "set",
      "sport",
    ]);
    expect(rows.map((r) => r.color)).toEqual([
      "dusty-rose",
      "plum",
      "sage",
      "primary",
      "dusty-rose",
      "primary",
    ]);
  });

  it("توضیحِ هر قاب پیراسته می‌شود و نشان فقط وقتی هست که مدیر نوشته", () => {
    const [sport, bra] = resolveArtFrames([
      { kind: "sport", color: "primary", note: "  کششِ آزاد  ", badge: "  تازه  " },
      { kind: "bra", color: "primary" },
    ]);
    expect(sport.note).toBe("کششِ آزاد");
    expect(sport.badge).toBe("تازه");
    // توضیحِ خالی = متنِ پیش‌فرضِ برند؛ نشانِ خالی = بدون نشان (ادعای فروش پیش‌فرض نداریم)
    expect(bra.note).toBe(ART_FRAME_NOTES.bra);
    expect(bra.badge).toBe("");
  });

  it("طولِ توضیح و نشان در پاک‌سازیِ API بسته است", () => {
    const props = sanitizeBlockProps("ART_SHOWCASE", {
      frames: [{ kind: "bra", color: "primary", note: "x".repeat(120), badge: "y".repeat(40) }],
    });
    const row = (props.frames as Array<Record<string, string>>)[0];
    expect(row.note).toHaveLength(80);
    expect(row.badge).toHaveLength(24);
  });

  it("قفسهٔ پیش‌فرض توضیح دارد و کلیدِ نشان‌ها پیش‌فرض روشن است", () => {
    const props = sanitizeBlockProps("ART_SHOWCASE", {});
    const rows = props.frames as Array<Record<string, string>>;
    expect(rows.map((r) => r.kind)).toEqual(ART_FRAME_DEFAULTS.map((f) => f.kind));
    expect(rows.every((r) => typeof r.note === "string" && r.note.length > 0)).toBe(true);
    expect(props.showBadges).toBe(true);
    // خاموش‌کردن کلید نشان را برمی‌دارد ولی متنِ نشان را پاک نمی‌کند
    expect(sanitizeBlockProps("ART_SHOWCASE", { showBadges: false }).showBadges).toBe(false);
  });
});

describe("Phase 17 — محافظ‌های انتشار و شناسه", () => {
  it("انتشار صفحهٔ خالی رد می‌شود (EMPTY_PAGE)", async () => {
    const empty = { version: 1, title: "خالی", seo: {}, blocks: [] };
    const svc = new CmsService(makePrisma([row("about", empty, "DRAFT")]) as never);
    await expect(svc.publish("about", "u1")).rejects.toThrow(BadRequestException);
  });

  it("slug نامعتبر (تزریق مسیر/فاصله/بزرگ) رد می‌شود", async () => {
    const svc = new CmsService(makePrisma() as never);
    await expect(svc.get("../etc")).rejects.toThrow(BadRequestException);
    await expect(svc.get("About Us")).rejects.toThrow(BadRequestException);
  });

  it("خواندن slug ناموجود → 404", async () => {
    const svc = new CmsService(makePrisma() as never);
    await expect(svc.get("ghost")).rejects.toThrow(NotFoundException);
  });
});
