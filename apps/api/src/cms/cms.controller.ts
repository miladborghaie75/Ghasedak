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
  type CmsPageData,
  type CmsPageSummary,
} from "@ghasedak/contracts";

/**
 * ط³ط±ظˆغŒط³ طµظپط­ظ‡â€Œط³ط§ط² â€” ظ…ظ†ط·ظ‚ ط¯ط§ظ…ظ†ظ‡ظ” CMS.
 *
 * ظ‚ظˆط§ظ†غŒظ† ط§غŒظ† ط³ط±ظˆغŒط³:
 *  غ±) ظ‡ط± payload ط§ط² ظ…ط³غŒط± `normalizeCmsPage` ط±ط¯ ظ…غŒâ€Œط´ظˆط¯ â†’ ظ†ط§ط´ظ†ط§ط®طھظ‡â€Œظ‡ط§
 *     ط­ط°ظپطŒ ظ†ظˆط¹â€Œظ‡ط§ ظ…ط­ط¯ظˆط¯طŒ ظˆ ظ‡غŒع† HTML/ط§ط³ع©ط±غŒظ¾طھ ط®ط§ظ…غŒ ط±ط§ظ‡ ظ†ظ…غŒâ€Œط§ظپطھط¯.
 *  غ²) ظ‡ط± ط°ط®غŒط±ظ‡ غŒع© `ContentRevision` ظ…غŒâ€Œط³ط§ط²ط¯ â†’ ط§ظ…ع©ط§ظ† ط¨ط§ط²ع¯ط´طھ ط¨ظ‡ ظ†ط³ط®ظ‡ظ” ظ‚ط¨ظ„.
 *  غ³) ط§ظ†طھط´ط§ط± ظˆ ظ¾غŒط´â€Œظ†ظˆغŒط³ ط¬ط¯ط§ â†’ ظپط±ظˆط´ع¯ط§ظ‡ ظپظ‚ط· `PUBLISHED` ط±ط§ ظ…غŒâ€Œط¨غŒظ†ط¯.
 *  غ´) slug ظ‚ظپظ„ ط§ط³طھط› طھط؛غŒغŒط± غŒط¹ظ†غŒ طµظپط­ظ‡ظ” طھط§ط²ظ‡ (طھط§ ظ„غŒظ†ع©â€Œظ‡ط§غŒ ط«ط§ط¨طھ ط³ط§غŒطھ ظ†ط´ع©ظ†ط¯).
 */
@Injectable()
export class CmsService {
  constructor(private readonly prisma: PrismaService) {}

  /** slug ظ…ط¹طھط¨ط±: ط­ط±ظˆظپ ع©ظˆع†ع©طŒ ط¹ط¯ط¯طŒ ط®ط· طھغŒط±ظ‡ â€” ط¨ط¯ظˆظ† ظپط§طµظ„ظ‡ ظˆ طھط²ط±غŒظ‚ ظ…ط³غŒط± */
  private assertSlug(slug: string): string {
    const s = String(slug ?? "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(s)) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "ط´ظ†ط§ط³ظ‡ظ” طµظپط­ظ‡ ظ…ط¹طھط¨ط± ظ†غŒط³طھ â€” ظپظ‚ط· ط­ط±ظˆظپ ع©ظˆع†ع© ط§ظ†ع¯ظ„غŒط³غŒطŒ ط¹ط¯ط¯ ظˆ ط®ط· طھغŒط±ظ‡.",
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
      // audit ظ†ط¨ط§غŒط¯ ط°ط®غŒط±ظ‡ظ” ظ…ط­طھظˆط§ ط±ط§ ط§ط² ع©ط§ط± ط¨غŒظ†ط¯ط§ط²ط¯
    }
  }

  private toSummary(row: {
    slug: string;
    payload: unknown;
    status: string;
    updatedAt: Date;
    publishedAt: Date | null;
  }): CmsPageSummary {
    const page = normalizeCmsPage(row.payload);
    return {
      slug: row.slug,
      title: page.title,
      status: row.status as CmsPageSummary["status"],
      blockCount: page.blocks.length,
      updatedAt: row.updatedAt.toISOString(),
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    };
  }

  async list(): Promise<{ items: CmsPageSummary[] }> {
    const rows = await this.prisma.cmsPage.findMany({ orderBy: { slug: "asc" } });
    return { items: rows.map((r) => this.toSummary(r)) };
  }

  async get(slug: string): Promise<{ slug: string; status: string; data: CmsPageData; publishedAt: Date | null; updatedAt: string }> {
    const s = this.assertSlug(slug);
    const row = await this.prisma.cmsPage.findUnique({ where: { slug: s } });
    if (!row) {
      throw new NotFoundException({ code: "PAGE_NOT_FOUND", message: "طµظپط­ظ‡ غŒط§ظپطھ ظ†ط´ط¯." });
    }
    return {
      slug: row.slug,
      status: row.status,
      data: normalizeCmsPage(row.payload),
      publishedAt: row.publishedAt,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** ط³ط§ط®طھ طµظپط­ظ‡ظ” طھط§ط²ظ‡ ط¨ط§ ط§ط³ع©ظ„طھ ط§ظˆظ„غŒظ‡ (ط®ط§ظ„غŒ غŒط§ ط§ط² غŒع© ط§ظ„ع¯ظˆغŒ ظ¾غŒط´ظ†ظ‡ط§ط¯غŒ) */
  async create(
    slug: string,
    title: string,
    starter: "empty" | "landing",
    actor: string | undefined,
  ): Promise<{ slug: string; data: CmsPageData }> {
    const s = this.assertSlug(slug);
    const exists = await this.prisma.cmsPage.findUnique({ where: { slug: s } });
    if (exists) {
      throw new BadRequestException({
        code: "PAGE_EXISTS",
        message: "طµظپط­ظ‡â€Œط§غŒ ط¨ط§ ط§غŒظ† ط´ظ†ط§ط³ظ‡ ط§ط² ظ‚ط¨ظ„ ظˆط¬ظˆط¯ ط¯ط§ط±ط¯.",
      });
    }
    const data = starter === "landing" ? landingTemplate(title) : emptyCmsPage(title);
    await this.prisma.cmsPage.create({
      data: { slug: s, payload: data as object, status: "DRAFT", updatedBy: actor ?? null },
    });
    await this.audit(actor, "cms.page.create", s, { title });
    return { slug: s, data };
  }

  /** ط°ط®غŒط±ظ‡ظ” ظ¾غŒط´â€Œظ†ظˆغŒط³ â€” payload ظ‡ظ…غŒط´ظ‡ ظ†ط±ظ…ط§ظ„â€Œط³ط§ط²غŒ ظ…غŒâ€Œط´ظˆط¯ */
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
    // ظ†ط³ط®ظ‡ظ” ظ‚ط¨ظ„غŒ ظ†ع¯ظ‡ ط¯ط§ط´طھظ‡ ظ…غŒâ€Œط´ظˆط¯ طھط§ ط¨ط´ظˆط¯ ط¨ط±ع¯ط´طھ
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
    if (!row) throw new NotFoundException({ code: "PAGE_NOT_FOUND", message: "طµظپط­ظ‡ غŒط§ظپطھ ظ†ط´ط¯." });
    const now = new Date();
    await this.prisma.cmsPage.update({
      where: { slug: s },
      data: { status: "PUBLISHED", publishedAt: now, updatedBy: actor ?? null },
    });
    await this.audit(actor, "cms.page.publish", s);
    return { slug: s, publishedAt: now.toISOString() };
  }

  async unpublish(slug: string, actor: string | undefined): Promise<{ slug: string }> {
    const s = this.assertSlug(slug);
    const row = await this.prisma.cmsPage.findUnique({ where: { slug: s } });
    if (!row) throw new NotFoundException({ code: "PAGE_NOT_FOUND", message: "طµظپط­ظ‡ غŒط§ظپطھ ظ†ط´ط¯." });
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

  /** ط¨ط§ط²ع¯ط±ط¯ط§ظ†ط¯ظ† غŒع© ظ†ط³ط®ظ‡ظ” ظ‚ط¨ظ„غŒ â€” ط¨ظ‡â€Œطµظˆط±طھ ظ¾غŒط´â€Œظ†ظˆغŒط³ (ظ†ظ‡ ط§ظ†طھط´ط§ط± ظپظˆط±غŒ) */
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
      throw new NotFoundException({ code: "REVISION_NOT_FOUND", message: "ظ†ط³ط®ظ‡ غŒط§ظپطھ ظ†ط´ط¯." });
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
   * ط®ظˆط§ظ†ط¯ظ† ط¹ظ…ظˆظ…غŒ ط¨ط±ط§غŒ ظپط±ظˆط´ع¯ط§ظ‡.
   * ظپظ‚ط· `PUBLISHED` ط¨ط±ظ…غŒâ€Œع¯ط±ط¯ط¯ â€” ظ…ع¯ط± ط¢ظ†ع©ظ‡ `preview=true` ظˆ ظ†ط´ط³طھ ط§ط¯ظ…غŒظ† ظ…ط¹طھط¨ط± ط¨ط§ط´ط¯
   * (ظ¾غŒط´â€Œظ†ظ…ط§غŒط´ ط²ظ†ط¯ظ‡ظ” طµظپط­ظ‡â€Œط³ط§ط² ط¨ط§غŒط¯ ظ¾غŒط´â€Œظ†ظˆغŒط³ ط±ط§ ظ‡ظ… ط¨ط¨غŒظ†ط¯).
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

    return {
      slug: row.slug,
      data: normalizeCmsPage(row.payload),
      status: row.status,
      preview: row.status !== "PUBLISHED",
    };
  }
}

/** ط§ظ„ع¯ظˆغŒ ط´ط±ظˆط¹ ط¢ظ…ط§ط¯ظ‡ â€” طھط§ طµظپط­ظ‡ظ” طھط§ط²ظ‡ ط®ط§ظ„غŒ ظ†ط¨ط§ط´ط¯ ظˆ ع©ط§ط±ط¨ط± ط¨ظ„ط§ظپط§طµظ„ظ‡ ع†غŒط²غŒ ط¨ط¨غŒظ†ط¯ */
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
          subtitle: "طھظˆط¶غŒط­ ع©ظˆطھط§ظ‡ ظپط±ظˆط´ع¯ط§ظ‡ ط±ط§ ط§غŒظ†ط¬ط§ ط¨ظ†ظˆغŒط³غŒط¯.",
          ctaLabel: "ظ…ط´ط§ظ‡ط¯ظ‡ ظ…ط­طµظˆظ„ط§طھ",
          ctaHref: "/c/bra",
        },
      },
      { type: "CATEGORY_GRID", props: { title: "ط¯ط³طھظ‡â€Œط¨ظ†ط¯غŒâ€Œظ‡ط§", limit: 6 } },
      { type: "PRODUCT_CAROUSEL", props: { title: "ط¬ط¯غŒط¯طھط±غŒظ†â€Œظ‡ط§", source: "newest", limit: 8 } },
      { type: "FEATURE_TRIPLE", props: {} },
      { type: "TRUST_BAR", props: {} },
    ],
  });
  return base;
}

/* â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ ع©ظ†طھط±ظ„ط±ظ‡ط§ â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ */

/** ظ…ط¯غŒط±غŒطھ طµظپط­ظ‡â€Œظ‡ط§ â€” ظپظ‚ط· ط¨ط§ ظ…ط¬ظˆط² ظ…ط§ط±ع©طھغŒظ†ع¯ */
@Controller("admin/pages")
export class CmsAdminController {
  constructor(private readonly cms: CmsService) {}

  @Get()
  @RequirePermission("marketing.view")
  async list() {
    return this.cms.list();
  }

  @Get(":slug")
  @RequirePermission("marketing.view")
  async get(@Param("slug") slug: string) {
    return this.cms.get(slug);
  }

  @Post()
  @RequirePermission("marketing.manage")
  async create(
    @Body() body: { slug?: string; title?: string; starter?: "empty" | "landing" },
    @Identity() me: AdminIdentity | null,
  ) {
    return this.cms.create(
      String(body.slug ?? ""),
      String(body.title ?? "طµظپط­ظ‡ظ” طھط§ط²ظ‡"),
      body.starter === "empty" ? "empty" : "landing",
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
 * ط®ظˆط§ظ†ط¯ظ† ط¹ظ…ظˆظ…غŒ طµظپط­ظ‡ ط¨ط±ط§غŒ ظپط±ظˆط´ع¯ط§ظ‡.
 * ط¨ط¯ظˆظ† `@RequirePermission` â€” ظ…ط³غŒط± ط¹ظ…ظˆظ…غŒ ط§ط³طھطŒ ظˆظ„غŒ ظ¾غŒط´â€Œظ†ظˆغŒط³ ط±ط§ ظپظ‚ط·
 * ظ†ط´ط³طھ ط§ط¯ظ…غŒظ† ظ…غŒâ€Œط¨غŒظ†ط¯ (ظ†ظ‡ ظ‡ط± ع©ط³غŒ).
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