import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { REPLACEMENT_CHAR, findDirtyText, type DirtyTextReason } from "../common/text-guard";
import { backgroundWorkersEnabled } from "../common/background-workers";

/**
 * گام F0-3 — «جاب سلامت داده»: یافتن و اصلاح متن خرابِ *ذخیره‌شده*.
 *
 * گارد نوشتن ([text-guard](../common/text-guard.ts)) جلوی ورود دادهٔ تازهٔ
 * خراب را می‌گیرد، ولی ردیف‌هایی که پیش‌تر وارد شده‌اند سر جایشان هستند —
 * در بازرسی دو محصول PUBLISHED با نام تماماً U+FFFD و اسلاگ `-` و
 * `--muena3ig` در کاتالوگ عمومی دیده شد. این سرویس همان‌ها را پیدا و
 * اصلاح می‌کند.
 *
 * سیاست اصلاح (مهم — صادقانه، نه آرایشی):
 *  ۱. نام خراب بازیابی‌شدنی نیست؛ پس **حدس نمی‌زنیم**. یک برچسب حقیقی از
 *     شواهد باقی‌مانده ساخته می‌شود («نام اصلی از دست رفته — SKU: …»).
 *  ۲. ردیف اصلاح‌شده `ARCHIVED` می‌شود: از سایت عمومی بیرون می‌رود ولی
 *     سفارش/انبار/دفتر کل و کلیدهای خارجی دست‌نخورده می‌مانند (حذف نمی‌کنیم).
 *  ۳. فیلد اختیاری خراب (توضیح کوتاه/بلند/SEO) پاک می‌شود — نمایش متن
 *     خراب بدتر از نبودن متن است.
 *  ۴. هر ردیف یک AuditLog با قبل/بعد می‌گیرد؛ اجرای دوباره هیچ تغییری
 *     نمی‌دهد (idempotent) و فقط ALREADY_REPAIRED گزارش می‌کند.
 *
 * اجرا: (۱) اکشن ادمین «اسکن/اصلاح کیفیت داده» در مرورگر،
 *        (۲) worker دوره‌ای *فقط اسکن* می‌کند و هشدار می‌دهد (تغییر بی‌صدا
 *        توسط worker = ممنوع؛ اصلاح همیشه با تصمیم اپراتور است).
 */

export type DataHealthEntity = "Product" | "Category" | "Brand";
export type DataHealthReason = DirtyTextReason | "INVALID_SLUG";
export type DataHealthField = "name" | "shortDescription" | "description" | "slug";

export interface DataHealthFinding {
  entity: DataHealthEntity;
  id: string;
  field: DataHealthField;
  reason: DataHealthReason;
  /** نام فعلی ردیف — برای اینکه اپراتور بدون بازکردن رکورد بفهمد کدام است */
  label: string;
  /** پیش‌نمایش مقدار خراب؛ U+FFFD به «□» تبدیل می‌شود تا دیده شود */
  value: string | null;
  status: string;
  /** فقط ردیف‌های متنی قابل اصلاح خودکارند (دسته/برند فقط گزارش می‌شوند) */
  repairable: boolean;
}

export interface DataHealthReport {
  checkedAt: string;
  tookMs: number;
  /** شمار یافته‌ها (فیلد‌محور) */
  dirtyCount: number;
  /** شمار ردیف‌های متأثر */
  affectedRows: number;
  repairableRows: number;
  findings: DataHealthFinding[];
}

export interface DataHealthRepairOutcome {
  entity: DataHealthEntity;
  id: string;
  action: "REPAIRED" | "SKIPPED";
  reason?: "ALREADY_REPAIRED";
  nameBefore: string;
  nameAfter: string;
  slugBefore: string;
  slugAfter: string;
  statusBefore: string;
  statusAfter: string;
  clearedFields: string[];
}

export interface DataHealthRepairResult {
  rowsSeen: number;
  repaired: number;
  skipped: number;
  outcomes: DataHealthRepairOutcome[];
  reportAfter: DataHealthReport;
}

interface RawRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  shortDescription?: string | null;
  description?: string | null;
}

/** پیش‌نمایش خوانا از مقدار خراب — جای کاراکتر جانشین «□» می‌گذاریم */
function preview(value: string | null | undefined, max = 60): string | null {
  if (value == null || value === "") return null;
  const shown = value.split(REPLACEMENT_CHAR).join("□");
  return shown.length > max ? `${shown.slice(0, max)}…` : shown;
}

/** اسلاگ نامعتبر: تهی، با خط تیره شروع/تمام، فاصله‌دار یا حاوی متن خراب */
export function isInvalidSlug(slug: string | null | undefined): boolean {
  if (!slug) return true;
  if (slug.startsWith("-") || slug.endsWith("-")) return true;
  if (/\s/.test(slug)) return true;
  if (slug === "-" || /^-+$/.test(slug)) return true;
  return findDirtyText(slug) !== null;
}

/** اسلاگ بازیابی — از شواهد باقی‌مانده (SKU) و همیشه قابل‌تشخیص */
function recoveredSlug(token: string, id: string): string {
  const base = token
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `recovered-${base || id.slice(-8)}`.slice(0, 80);
}

@Injectable()
export class DataHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DataHealthService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (!backgroundWorkersEnabled()) {
      this.logger.log("Background workers disabled (GHASEDAK_WORKERS=off) — DataHealth timer not started");
      return;
    }
    // هر ۶ ساعت اسکن *فقط-خواندنی* + هشدار؛ اصلاح خودکار توسط worker ممنوع
    this.timer = setInterval(() => void this.scanAndWarn(), 6 * 60 * 60_000);
    void this.scanAndWarn();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async scanAndWarn(): Promise<void> {
    try {
      const report = await this.scan();
      if (report.dirtyCount === 0) return;
      this.logger.warn(
        `Data health: ${report.dirtyCount} یافتهٔ متن خراب در ${report.affectedRows} ردیف — اکشن «اصلاح کیفیت داده» را در تنظیمات → عیب‌یابی اجرا کنید`,
      );
      // نوتیف روزانه (idempotent با کلید سطل روز) — بند ۸/۱۱۱: بی‌صدا نمی‌ماند
      const dayBucket = new Date().toISOString().slice(0, 10);
      const key = `data-health:${dayBucket}`;
      const dup = await this.prisma.notification.findFirst({ where: { channel: "ADMIN", templateKey: key } });
      if (!dup) {
        await this.prisma.notification.create({
          data: {
            channel: "ADMIN",
            templateKey: key,
            to: "admin-dashboard",
            payload: {
              title: "متن خراب در داده‌ها پیدا شد",
              dirtyCount: report.dirtyCount,
              affectedRows: report.affectedRows,
              hint: "تنظیمات → عیب‌یابی → کیفیت داده → «اسکن و اصلاح»",
            },
          },
        });
      }
    } catch (e) {
      this.logger.error(`Data health worker failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** اسکن فقط-خواندنی — هیچ تغییری نمی‌دهد */
  async scan(): Promise<DataHealthReport> {
    const t0 = Date.now();
    const like = `%${REPLACEMENT_CHAR}%`;

    const [products, categories, brands] = await Promise.all([
      this.prisma.$queryRaw<RawRow[]>`
        SELECT id, name, slug, status, "shortDescription", description
        FROM "Product"
        WHERE "deletedAt" IS NULL AND (
          name LIKE ${like}
          OR COALESCE("shortDescription", '') LIKE ${like}
          OR COALESCE(description, '') LIKE ${like}
          OR name ~ '[[:cntrl:]]'
          OR slug = '' OR slug ~ '^-' OR slug LIKE ${like}
        )
        ORDER BY "createdAt" ASC
        LIMIT 500
      `,
      this.prisma.$queryRaw<RawRow[]>`
        SELECT id, name, slug, status, description
        FROM "Category"
        WHERE "deletedAt" IS NULL AND (
          name LIKE ${like}
          OR COALESCE(description, '') LIKE ${like}
          OR name ~ '[[:cntrl:]]'
          OR slug = '' OR slug ~ '^-' OR slug LIKE ${like}
        )
        ORDER BY "createdAt" ASC
        LIMIT 500
      `,
      this.prisma.$queryRaw<RawRow[]>`
        SELECT id, name, slug, status, description
        FROM "Brand"
        WHERE "deletedAt" IS NULL AND (
          name LIKE ${like}
          OR COALESCE(description, '') LIKE ${like}
          OR name ~ '[[:cntrl:]]'
          OR slug = '' OR slug ~ '^-' OR slug LIKE ${like}
        )
        ORDER BY "createdAt" ASC
        LIMIT 500
      `,
    ]);

    const findings: DataHealthFinding[] = [];
    const affected = new Set<string>();
    let repairableRows = 0;

    const collect = (entity: DataHealthEntity, row: RawRow, options: { fields: DataHealthField[]; repairable: boolean }) => {
      let hit = false;
      for (const field of options.fields) {
        const raw = (row as unknown as Record<string, string | null | undefined>)[field];
        const reason = findDirtyText(raw);
        if (!reason) continue;
        hit = true;
        findings.push({
          entity,
          id: row.id,
          field,
          reason,
          label: preview(row.name, 40) ?? row.id,
          value: preview(raw),
          status: row.status,
          repairable: options.repairable,
        });
      }
      // اسلاگ نامعتبر (بدون توجه به متن خراب، مستقل گزارش می‌شود)
      if (isInvalidSlug(row.slug)) {
        hit = true;
        findings.push({
          entity,
          id: row.id,
          field: "slug",
          reason: findDirtyText(row.slug) ?? "INVALID_SLUG",
          label: preview(row.name, 40) ?? row.id,
          value: preview(row.slug),
          status: row.status,
          repairable: options.repairable,
        });
      }
      if (hit) {
        affected.add(`${entity}:${row.id}`);
        if (options.repairable) repairableRows += 1;
      }
    };

    for (const row of products) {
      collect("Product", row, { fields: ["name", "shortDescription", "description"], repairable: true });
    }
    for (const row of categories) collect("Category", row, { fields: ["name", "description"], repairable: false });
    for (const row of brands) collect("Brand", row, { fields: ["name", "description"], repairable: false });

    return {
      checkedAt: new Date().toISOString(),
      tookMs: Date.now() - t0,
      dirtyCount: findings.length,
      affectedRows: affected.size,
      repairableRows,
      findings,
    };
  }

  /**
   * اصلاح ردیف‌های خراب محصول — idempotent و audited.
   * `ids` مشخص‌شده = فقط همان ردیف‌ها؛ بدون آن همهٔ ردیف‌های خراب.
   */
  async repair(actorId?: string, ids?: string[]): Promise<DataHealthRepairResult> {
    const like = `%${REPLACEMENT_CHAR}%`;
    const rows = await this.prisma.$queryRaw<RawRow[]>`
      SELECT id, name, slug, status, "shortDescription", description
      FROM "Product"
      WHERE "deletedAt" IS NULL AND (
        name LIKE ${like}
        OR COALESCE("shortDescription", '') LIKE ${like}
        OR COALESCE(description, '') LIKE ${like}
        OR name ~ '[[:cntrl:]]'
        OR slug = '' OR slug ~ '^-' OR slug LIKE ${like}
      )
      ORDER BY "createdAt" ASC
      LIMIT 500
    `;
    const target = ids?.length ? rows.filter((r) => ids.includes(r.id)) : rows;

    const outcomes: DataHealthRepairOutcome[] = [];
    for (const row of target) {
      const variants = await this.prisma.productVariant.findMany({
        where: { productId: row.id },
        select: { sku: true },
        orderBy: { createdAt: "asc" },
        take: 3,
      });
      const evidence = variants.length
        ? `SKU: ${variants.map((v) => v.sku).join(" / ")}`
        : `شناسه: ${row.id}`;
      const honestName = `نام اصلی از دست رفته — ${evidence}`;

      const nameDirty = findDirtyText(row.name) !== null;
      const badSlug = isInvalidSlug(row.slug);
      const clearedFields: string[] = [];
      if (findDirtyText(row.shortDescription) !== null) clearedFields.push("shortDescription");
      if (findDirtyText(row.description) !== null) clearedFields.push("description");

      const targetStatus = nameDirty ? "ARCHIVED" : row.status;
      const targetName = nameDirty ? honestName : row.name;
      const targetSlug = badSlug ? await this.uniqueProductSlug(recoveredSlug(variants[0]?.sku ?? "", row.id), row.id) : row.slug;

      const unchanged =
        targetName === row.name &&
        targetSlug === row.slug &&
        targetStatus === row.status &&
        clearedFields.length === 0;

      if (unchanged) {
        outcomes.push({
          entity: "Product", id: row.id, action: "SKIPPED", reason: "ALREADY_REPAIRED",
          nameBefore: row.name, nameAfter: row.name,
          slugBefore: row.slug, slugAfter: row.slug,
          statusBefore: row.status, statusAfter: row.status,
          clearedFields: [],
        });
        continue;
      }

      const data: Record<string, unknown> = { name: targetName, slug: targetSlug, status: targetStatus };
      for (const f of clearedFields) data[f] = null;
      // متن نامعتبر در SEO/آرشیو هم اگر باشد پاک می‌شود (بازیابی‌ناپذیر است)
      const seo = await this.prisma.product.findUnique({ where: { id: row.id }, select: { seoId: true } });
      if (seo?.seoId) {
        const meta = await this.prisma.seoMeta.findUnique({ where: { id: seo.seoId } });
        if (meta) {
          const seoClear: Record<string, unknown> = {};
          for (const f of ["seoTitle", "metaDescription", "ogTitle", "ogDescription", "canonical"] as const) {
            if (findDirtyText(meta[f]) !== null) { seoClear[f] = null; clearedFields.push(`seo.${f}`); }
          }
          if (Object.keys(seoClear).length) await this.prisma.seoMeta.update({ where: { id: meta.id }, data: seoClear });
        }
      }

      await this.prisma.product.update({ where: { id: row.id }, data });

      await this.prisma.auditLog
        .create({
          data: {
            actorId: actorId ?? null,
            action: "data.health.repair",
            entity: "Product",
            entityId: row.id,
            oldValues: { name: row.name, slug: row.slug, status: row.status, clearedFields: clearedFields.join(",") },
            newValues: { name: targetName, slug: targetSlug, status: targetStatus, evidence, clearedFields },
          },
        })
        .catch(() => undefined); // شکست audit نباید اصلاح را بی‌اثر کند

      outcomes.push({
        entity: "Product", id: row.id, action: "REPAIRED",
        nameBefore: row.name, nameAfter: targetName,
        slugBefore: row.slug, slugAfter: targetSlug,
        statusBefore: row.status, statusAfter: targetStatus,
        clearedFields,
      });
    }

    return {
      rowsSeen: target.length,
      repaired: outcomes.filter((o) => o.action === "REPAIRED").length,
      skipped: outcomes.filter((o) => o.action === "SKIPPED").length,
      outcomes,
      reportAfter: await this.scan(),
    };
  }

  /** اسلاگ یکتا برای ردیف اصلاح‌شده (`Product.slug` یکتاست) */
  private async uniqueProductSlug(base: string, selfId: string): Promise<string> {
    let candidate = base;
    for (let i = 2; i <= 20; i += 1) {
      const clash = await this.prisma.product.findFirst({
        where: { slug: candidate, id: { not: selfId } },
        select: { id: true },
      });
      if (!clash) return candidate;
      candidate = `${base}-${i}`;
    }
    return `${base}-${selfId.slice(-6)}`;
  }
}
