import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RequirePermission } from "../auth/permissions.guard";
import { Identity } from "../auth/identity.decorator";
import type { AdminIdentity } from "../auth/auth.service";
import {
  emptyCmsPage,
  normalizeCmsPage,
  siteContentBySlug,
  siteContentToCmsPage,
  SITE_PAGES,
  sitePathForSlug,
  type CmsPageData,
  type CmsPageSummary,
  type SitePageKind,
} from "@ghasedak/contracts";

/** وضعیت CMS یک مسیر — همان چیزی که پنل برای نشان-badge لازم دارد */
export interface SitePageCmsStatus {
  status: CmsPageSummary["status"];
  blockCount: number;
  updatedAt: string;
  publishedAt: string | null;
  /** پیش‌نویس با نسخهٔ منتشرشده تفاوت دارد → سایت هنوز نسخهٔ قبلی را نشان می‌دهد */
  hasUnpublishedChanges: boolean;
}

/**
 * اثر انگشت محتوایی یک صفحه — برای «پیش‌نویس با منتشرشده فرق دارد؟».
 *
 * چرا شناسهٔ بلوک در اثر انگشت نیست: `normalizeCmsPage` برای بلوکِ بی‌شناسه
 * شناسهٔ تصادفی می‌سازد، پس مقایسهٔ خامِ JSON همیشه «تغییر کرده» می‌داد و
 * نشانگر «تغییرات منتشرنشده» همیشه روشن می‌ماند. شناسه هویت ویرایشی است،
 * نه محتوا: جابه‌جایی/تغییر متن چیزی است که مشتری می‌بیند.
 */
function contentFingerprint(page: CmsPageData): string {
  return JSON.stringify({
    title: page.title,
    seo: page.seo ?? {},
    blocks: page.blocks.map((b) => ({ type: b.type, props: b.props, hidden: b.hidden === true })),
  });
}

/**
 * آیا پیش‌نویس با اسنپ‌شات منتشرشده فرق دارد؟
 *
 * `published === null` یعنی صفحه هنوز هرگز از این مسیر منتشر نشده؛ آن‌جا
 * چیزی برای مقایسه نیست (وضعیت خودش «پیش‌نویس» است).
 */
function hasPendingChanges(draft: CmsPageData, published: unknown): boolean {
  if (published === null || published === undefined) return false;
  return contentFingerprint(normalizeCmsPage(published)) !== contentFingerprint(draft);
}

/** یک ردیف از «صفحات سایت» — مسیر واقعی + وضعیت صفحه‌سازش */
export interface SitePageItem {
  path: string;
  slug: string | null;
  title: string;
  kind: SitePageKind;
  editable: boolean;
  note?: string;
  cms: SitePageCmsStatus | null;
}

/**
 * سرویس صفحه‌ساز — منطق دامنهٔ CMS.
 *
 * قوانین این سرویس:
 *  ۱) هر payload از مسیر `normalizeCmsPage` رد می‌شود → ناشناخته‌ها
 *     حذف، نوع‌ها محدود، و هیچ HTML/اسکریپت خامی راه نمی‌افتد.
 *  ۲) هر ذخیره یک `ContentRevision` می‌سازد → امکان بازگشت به نسخهٔ قبل.
 *  ۳) انتشار و پیش‌نویس جدا → فروشگاه فقط `PUBLISHED` را می‌بیند.
 *  ۴) slug قفل است؛ تغییر یعنی صفحهٔ تازه (تا لینک‌های ثابت سایت نشکند).
 */
@Injectable()
export class CmsService {
  constructor(private readonly prisma: PrismaService) {}

  /** slug معتبر: حروف کوچک، عدد، خط تیره — بدون فاصله و تزریق مسیر */
  private assertSlug(slug: string): string {
    const s = String(slug ?? "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(s)) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "شناسهٔ صفحه معتبر نیست — فقط حروف کوچک انگلیسی، عدد و خط تیره.",
      });
    }
    return s;
  }

  private async audit(
    actorId: string | undefined,
    action: string,
    entityId: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: actorId ?? null,
          action,
          entity: "CmsPage",
          entityId,
          newValues: (meta ?? {}) as object,
        },
      });
    } catch {
      // audit نباید ذخیرهٔ محتوا را از کار بیندازد
    }
  }

  private toSummary(row: {
    slug: string;
    payload: unknown;
    publishedPayload?: unknown;
    status: string;
    updatedAt: Date;
    publishedAt: Date | null;
  }): CmsPageSummary & { hasUnpublishedChanges: boolean } {
    const page = normalizeCmsPage(row.payload);
    return {
      slug: row.slug,
      title: page.title,
      status: row.status as CmsPageSummary["status"],
      blockCount: page.blocks.length,
      updatedAt: row.updatedAt.toISOString(),
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      hasUnpublishedChanges: row.status === "PUBLISHED" && hasPendingChanges(page, row.publishedPayload),
    };
  }

  async list(): Promise<{ items: CmsPageSummary[] }> {
    const rows = await this.prisma.cmsPage.findMany({ orderBy: { slug: "asc" } });
    return { items: rows.map((r) => this.toSummary(r)) };
  }

  /**
   * «صفحات سایت» — همهٔ مسیرهای واقعی فروشگاه با وضعیت صفحه‌سازشان.
   *
   * تا پیش از این، پنل فقط صفحه‌های ساخته‌شده در `CmsPage` را نشان می‌داد؛
   * مدیر نمی‌دید `/about` اصلاً در سایت هست یا `/p/*` داده‌ای است.
   * این متد دو چیز را کنار هم می‌گذارد:
   *  ۱) مسیرهای مرجع (`SITE_PAGES`) — هر مسیری که واقعاً در سایت وجود دارد؛
   *  ۲) صفحه‌های ساخته‌شده در CMS — شامل لندینگ‌های سفارشی که در فهرست
   *     مرجع نبودند.
   */
  async sitePages(): Promise<{ items: SitePageItem[] }> {
    const rows = await this.prisma.cmsPage.findMany({ orderBy: { slug: "asc" } });
    const bySlug = new Map(rows.map((r) => [r.slug, this.toSummary(r)]));

    const items: SitePageItem[] = SITE_PAGES.map((def) => {
      const summary = def.slug ? bySlug.get(def.slug) : undefined;
      return {
        path: def.path,
        slug: def.slug,
        title: def.title,
        kind: def.kind,
        editable: def.editable,
        note: def.note,
        cms: summary
          ? {
              status: summary.status,
              blockCount: summary.blockCount,
              updatedAt: summary.updatedAt,
              publishedAt: summary.publishedAt,
              hasUnpublishedChanges: summary.hasUnpublishedChanges,
            }
          : null,
      };
    });

    // صفحه‌های CMS که در فهرست مرجع نیستند → لندینگ سفارشی
    for (const [slug, summary] of bySlug) {
      if (SITE_PAGES.some((d) => d.slug === slug)) continue;
      items.push({
        path: sitePathForSlug(slug),
        slug,
        title: summary.title,
        kind: "CMS",
        editable: true,
        note: "صفحهٔ ساخته‌شده در صفحه‌ساز.",
        cms: {
          status: summary.status,
          blockCount: summary.blockCount,
          updatedAt: summary.updatedAt,
          publishedAt: summary.publishedAt,
          hasUnpublishedChanges: summary.hasUnpublishedChanges,
        },
      });
    }

    return { items };
  }

  async get(slug: string): Promise<{
    slug: string;
    status: string;
    data: CmsPageData;
    publishedAt: Date | null;
    updatedAt: string;
    hasUnpublishedChanges: boolean;
  }> {
    const s = this.assertSlug(slug);
    const row = await this.prisma.cmsPage.findUnique({ where: { slug: s } });
    if (!row) {
      throw new NotFoundException({ code: "PAGE_NOT_FOUND", message: "صفحه یافت نشد." });
    }
    const data = normalizeCmsPage(row.payload);
    return {
      slug: row.slug,
      status: row.status,
      data,
      publishedAt: row.publishedAt,
      updatedAt: row.updatedAt.toISOString(),
      hasUnpublishedChanges: row.status === "PUBLISHED" && hasPendingChanges(data, row.publishedPayload),
    };
  }

  /** ساخت صفحهٔ تازه با اسکلت اولیه (خالی، از یک الگوی پیشنهادی، یا از محتوای فعلی سایت) */
  async create(
    slug: string,
    title: string,
    starter: "empty" | "landing" | "simple" | "site",
    actor: string | undefined,
  ): Promise<{ slug: string; data: CmsPageData }> {
    const s = this.assertSlug(slug);
    const exists = await this.prisma.cmsPage.findUnique({ where: { slug: s } });
    if (exists) {
      throw new BadRequestException({
        code: "PAGE_EXISTS",
        message: "صفحه‌ای با این شناسه از قبل وجود دارد.",
      });
    }
    const data = this.buildStarter(s, title, starter);
    await this.prisma.cmsPage.create({
      data: { slug: s, payload: data as object, status: "DRAFT", updatedBy: actor ?? null },
    });
    await this.audit(actor, "cms.page.create", s, { title, starter });
    return { slug: s, data };
  }

  /**
   * اسکلتِ اولیهٔ صفحه.
   *
   * `site` یعنی «همان محتوایی که همین الان در سایت هست» — نه یک الگوی
   * عمومی. چرا مهم است؟ چون الگوی عمومی (`simple`) فقط یک هیرو و یک متنِ
   * خالی است: اگر مدیر آن را روی ‎/about می‌ساخت و منتشرش می‌کرد، متنِ
   * حقوقیِ دست‌نویسِ همان صفحه پاک می‌شد. با `site`، صفحه از همان متنِ
   * مشترکی ساخته می‌شود که سایت رندر می‌کند — پس تبدیل **وفادارانه** است.
   */
  private buildStarter(
    slug: string,
    title: string,
    starter: "empty" | "landing" | "simple" | "site",
  ): CmsPageData {
    if (starter === "landing") return landingTemplate(title);
    if (starter === "simple") return simpleTemplate(title);
    if (starter === "site") {
      const content = siteContentBySlug(slug);
      if (content) return siteContentToCmsPage(content, title);
      // مسیری که محتوایِ مشترک ندارد (خانه) → الگوی متناسب
      return slug === "home" ? landingTemplate(title) : simpleTemplate(title);
    }
    return emptyCmsPage(title);
  }

  /** ذخیرهٔ پیش‌نویس — payload همیشه نرمال‌سازی می‌شود */
  async save(slug: string, payload: unknown, actor: string | undefined): Promise<{ data: CmsPageData; status: string }> {
    const s = this.assertSlug(slug);
    const data = normalizeCmsPage(payload);
    const before = await this.prisma.cmsPage.findUnique({ where: { slug: s } });
    if (!before) {
      await this.prisma.cmsPage.create({
        data: { slug: s, payload: data as object, status: "DRAFT", updatedBy: actor ?? null },
      });
      await this.audit(actor, "cms.page.save", s, { created: true, blocks: data.blocks.length });
      return { data, status: "DRAFT" };
    }
    await this.prisma.cmsPage.update({
      where: { slug: s },
      data: { payload: data as object, updatedBy: actor ?? null },
    });
    // نسخهٔ قبلی نگه داشته می‌شود تا بشود برگشت
    await this.prisma.contentRevision.create({
      data: {
        entity: "CmsPage",
        entityId: s,
        payload: (before.payload ?? {}) as object,
        actorId: actor ?? null,
      },
    });
    await this.audit(actor, "cms.page.save", s, { blocks: data.blocks.length });
    return { data, status: before.status };
  }

  async publish(slug: string, actor: string | undefined): Promise<{ slug: string; publishedAt: string }> {
    const s = this.assertSlug(slug);
    const row = await this.prisma.cmsPage.findUnique({ where: { slug: s } });
    if (!row) throw new NotFoundException({ code: "PAGE_NOT_FOUND", message: "صفحه یافت نشد." });
    // ── محافظ: صفحهٔ خالی منتشر نمی‌شود.
    //    اگر صفحهٔ اصلی یا یک مسیر حقوقی خالی منتشر شود، سایت عملاً
    //    سفید می‌شود و راه برگشت هم سخت است. یک بلوک کافی است.
    const page = normalizeCmsPage(row.payload);
    if (page.blocks.length === 0) {
      throw new BadRequestException({
        code: "EMPTY_PAGE",
        message: "صفحهٔ خالی منتشر نمی‌شود — اول دست‌کم یک بلوک به آن اضافه کن.",
      });
    }
    const now = new Date();
    // اسنپ‌شات منتشرشده از همین پیش‌نویس ساخته می‌شود — تنها این اسنپ‌شات
    // است که بازدیدکننده می‌بیند (بند «پیش‌نویس ≠ منتشرشده»).
    await this.prisma.cmsPage.update({
      where: { slug: s },
      data: {
        status: "PUBLISHED",
        publishedAt: now,
        publishedPayload: page as unknown as object,
        updatedBy: actor ?? null,
      },
    });
    await this.audit(actor, "cms.page.publish", s);
    return { slug: s, publishedAt: now.toISOString() };
  }

  async unpublish(slug: string, actor: string | undefined): Promise<{ slug: string }> {
    const s = this.assertSlug(slug);
    const row = await this.prisma.cmsPage.findUnique({ where: { slug: s } });
    if (!row) throw new NotFoundException({ code: "PAGE_NOT_FOUND", message: "صفحه یافت نشد." });
    await this.prisma.cmsPage.update({
      where: { slug: s },
      data: { status: "DRAFT", updatedBy: actor ?? null },
    });
    await this.audit(actor, "cms.page.unpublish", s);
    return { slug: s };
  }

  async remove(slug: string, actor: string | undefined): Promise<{ ok: true }> {
    const s = this.assertSlug(slug);
    await this.prisma.cmsPage.delete({ where: { slug: s } });
    await this.audit(actor, "cms.page.delete", s);
    return { ok: true };
  }

  async revisions(slug: string): Promise<{ items: Array<{ id: string; createdAt: string; actorId: string | null }> }> {
    const s = this.assertSlug(slug);
    const rows = await this.prisma.contentRevision.findMany({
      where: { entity: "CmsPage", entityId: s },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, createdAt: true, actorId: true },
    });
    return { items: rows.map((r) => ({ id: r.id, createdAt: r.createdAt.toISOString(), actorId: r.actorId })) };
  }

  /** بازگرداندن یک نسخهٔ قبلی — به‌صورت پیش‌نویس (نه انتشار فوری) */
  async restore(
    slug: string,
    revisionId: string,
    actor: string | undefined,
  ): Promise<{ data: CmsPageData }> {
    const s = this.assertSlug(slug);
    const rev = await this.prisma.contentRevision.findFirst({
      where: { id: revisionId, entity: "CmsPage", entityId: s },
    });
    if (!rev) {
      throw new NotFoundException({ code: "REVISION_NOT_FOUND", message: "نسخه یافت نشد." });
    }
    const data = normalizeCmsPage(rev.payload);
    await this.prisma.cmsPage.update({
      where: { slug: s },
      data: { payload: data as object, updatedBy: actor ?? null },
    });
    await this.audit(actor, "cms.page.restore", s, { revisionId });
    return { data };
  }

  /**
   * خواندن عمومی برای فروشگاه.
   *
   * قانون تازه (گام ۱۷-۲): بازدیدکننده **همیشه** اسنپ‌شات منتشرشده را می‌بیند،
   * حتی اگر مدیر بعد از انتشار پیش‌نویس را عوض کرده باشد. تا پیش از این،
   * «ذخیره» روی صفحهٔ منتشرشده بی‌درنگ سایت را تغییر می‌داد و دکمهٔ انتشار
   * تشریفاتی بود.
   *
   * استثنا: `preview=true` با نشست ادمین مجاز → پیش‌نویس، برای بومِ زندهٔ پنل.
   * صفحهٔ `DRAFT` برای عموم چیزی برنمی‌گرداند (فروشگاه به چیدمان پیش‌فرض می‌رود).
   */
  async getPublic(
    slug: string,
    preview: boolean,
    identity: AdminIdentity | null,
  ): Promise<{ slug: string; data: CmsPageData; status: string; preview: boolean } | null> {
    const s = this.assertSlug(slug);
    const row = await this.prisma.cmsPage.findUnique({ where: { slug: s } });
    if (!row) return null;

    const canPreview =
      preview && !!identity && (identity.permissions.includes("*") || identity.permissions.includes("marketing.view"));
    if (row.status !== "PUBLISHED" && !canPreview) return null;

    // پنل: پیش‌نویسِ در حال ویرایش. عموم: آخرین اسنپ‌شات منتشرشده.
    const body = canPreview ? row.payload : (row.publishedPayload ?? row.payload);

    return {
      slug: row.slug,
      data: normalizeCmsPage(body),
      status: row.status,
      preview: canPreview,
    };
  }
}

/** الگوی شروع آماده — تا صفحهٔ تازه خالی نباشد و کاربر بلافاصله چیزی ببیند */
function landingTemplate(title: string): CmsPageData {
  const base = normalizeCmsPage({
    version: 1,
    title,
    seo: { title, description: "" },
    blocks: [
      {
        type: "HERO",
        props: {
          title,
          subtitle: "توضیح کوتاه فروشگاه را اینجا بنویسید.",
          ctaLabel: "مشاهده محصولات",
          ctaHref: "/c/bra",
        },
      },
      /*
       * نمونه‌کار آرت بلافاصله بعد از هیرو می‌نشیند: قاب بزرگ هیرو و قفسهٔ
       * آرت یک نوار بصری می‌سازند و کارت‌های محصول همان زبان را ادامه می‌دهند.
       * props خالی است تا متن‌های پیش‌فرضِ تعریف بلوک بنشینند.
       */
      { type: "ART_SHOWCASE", props: {} },
      { type: "CATEGORY_GRID", props: { title: "دسته‌بندی‌ها", limit: 6 } },
      { type: "PRODUCT_CAROUSEL", props: { title: "جدیدترین‌ها", source: "newest", limit: 8 } },
      { type: "FEATURE_TRIPLE", props: {} },
      { type: "TRUST_BAR", props: {} },
    ],
  });
  return base;
}

/**
 * الگوی ساده — برای صفحه‌های متنیِ واقعی (دربارهٔ ما، شرایط، تماس).
 *
 * چرا لازم است: قبلاً ساختِ یک مسیر واقعی با «empty» انجام می‌شد؛ نتیجه
 * بومِ سفید بود و محافظِ انتشار (EMPTY_PAGE) جلوی انتشار را می‌گرفت.
 * حالا هر صفحه از همان اول یک هیرو و یک بلوک متن دارد — قابل ویرایش و
 * قابل انتشار.
 */
function simpleTemplate(title: string): CmsPageData {
  return normalizeCmsPage({
    version: 1,
    title,
    seo: { title, description: "" },
    blocks: [
      {
        type: "HERO",
        props: {
          title,
          subtitle: "این متن را با توضیح واقعی این صفحه جایگزین کنید.",
        },
      },
      {
        type: "RICH_TEXT",
        props: {
          title: "متن صفحه",
          text: "متن این صفحه را اینجا بنویسید.",
          align: "start",
        },
      },
    ],
  });
}

/* ═══════════════════ کنترلرها ═══════════════════ */

/** مدیریت صفحه‌ها — فقط با مجوز مارکتینگ */
@Controller("admin/pages")
export class CmsAdminController {
  constructor(private readonly cms: CmsService) {}

  @Get()
  @RequirePermission("marketing.view")
  async list() {
    return this.cms.list();
  }

  /**
   * فهرست «صفحات سایت» — باید **قبل** از `:slug` تعریف شود تا Nest آن را
   * به‌عنوان پارامتر نگیرد.
   */
  @Get("site")
  @RequirePermission("marketing.view")
  async site() {
    return this.cms.sitePages();
  }

  @Get(":slug")
  @RequirePermission("marketing.view")
  async get(@Param("slug") slug: string) {
    return this.cms.get(slug);
  }

  @Post()
  @RequirePermission("marketing.manage")
  async create(
    @Body() body: { slug?: string; title?: string; starter?: "empty" | "landing" | "simple" | "site" },
    @Identity() me: AdminIdentity | null,
  ) {
    return this.cms.create(
      String(body.slug ?? ""),
      String(body.title ?? "صفحهٔ تازه"),
      body.starter === "empty" || body.starter === "simple" || body.starter === "site"
        ? body.starter
        : "landing",
      me?.userId,
    );
  }

  @Put(":slug")
  @RequirePermission("marketing.manage")
  async save(
    @Param("slug") slug: string,
    @Body() body: { payload?: unknown },
    @Identity() me: AdminIdentity | null,
  ) {
    return this.cms.save(slug, body.payload, me?.userId);
  }

  @Post(":slug/publish")
  @RequirePermission("marketing.manage")
  async publish(@Param("slug") slug: string, @Identity() me: AdminIdentity | null) {
    return this.cms.publish(slug, me?.userId);
  }

  @Post(":slug/unpublish")
  @RequirePermission("marketing.manage")
  async unpublish(@Param("slug") slug: string, @Identity() me: AdminIdentity | null) {
    return this.cms.unpublish(slug, me?.userId);
  }

  @Get(":slug/revisions")
  @RequirePermission("marketing.view")
  async revisions(@Param("slug") slug: string) {
    return this.cms.revisions(slug);
  }

  @Post(":slug/restore/:revisionId")
  @RequirePermission("marketing.manage")
  async restore(
    @Param("slug") slug: string,
    @Param("revisionId") revisionId: string,
    @Identity() me: AdminIdentity | null,
  ) {
    return this.cms.restore(slug, revisionId, me?.userId);
  }

  @Delete(":slug")
  @RequirePermission("marketing.manage")
  async remove(@Param("slug") slug: string, @Identity() me: AdminIdentity | null) {
    return this.cms.remove(slug, me?.userId);
  }
}

/**
 * خواندن عمومی صفحه برای فروشگاه.
 * بدون `@RequirePermission` — مسیر عمومی است، ولی پیش‌نویس را فقط
 * نشست ادمین می‌بیند (نه هر کسی).
 */
@Controller("cms/page")
export class CmsPublicController {
  constructor(private readonly cms: CmsService) {}

  @Get(":slug")
  async read(
    @Param("slug") slug: string,
    @Query("preview") preview: string | undefined,
    @Identity() me: AdminIdentity | null,
  ) {
    const result = await this.cms.getPublic(slug, preview === "1" || preview === "true", me);
    if (!result) return { found: false as const };
    return { found: true as const, ...result };
  }
}
