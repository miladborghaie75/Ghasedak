import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  PHOTO_BULK_APPROVE_MAX,
  PHOTO_SHOTS,
  PHOTO_STATUS_LABELS,
  PHOTO_TASK_STATUSES,
  PRIMARY_PHOTO_SHOT,
  isPhotoShotKind,
  photoSpecForCategory,
  type PhotoBulkApproveResult,
  type PhotoProgramBoard,
  type PhotoProgramCategory,
  type PhotoProgramProduct,
  type PhotoProgramShot,
  type PhotoShotKind,
  type PhotoTaskStatus,
} from "@ghasedak/contracts";
import { PrismaService } from "../prisma/prisma.service";

/**
 * برنامهٔ عکاسی محصول (گام ۲۰).
 *
 * این سرویس سه کار را یک‌جا نگه می‌دارد تا «عکسِ واقعی» و «آرتِ جانشین» دو حقیقت
 * جدا نشوند:
 *  ۱) تابلو: برای هر محصول و هر کادرِ استاندارد، وضعیتِ کار چیست؟
 *  ۲) چرخهٔ کار: عکس گرفته شد → تأیید شد / نیاز به عکسِ دوباره.
 *  ۳) جایگزینی: وقتی عکسِ «نمای صافِ جلو» تأیید شد، همان لحظه عکسِ اصلیِ محصول
 *     می‌شود و فروشگاه خودکار آرت را کنار می‌گذارد (و برعکس، با «عکسِ دوباره»
 *     محصول دوباره به آرت برمی‌گردد).
 *
 * چرا وضعیت‌ها در جدول‌اند و نه روی محصول؟ چون برنامه چندکادری است: هر محصول
 * چند کادر دارد و هر کادر چرخهٔ خودش را دارد. یکتایی «محصول × کادر» در DB
 * تضمین شده است (PhotoTask @@unique) تا یک کادر دو بار ثبت نشود.
 */
@Injectable()
export class PhotographyService {
  constructor(private readonly prisma: PrismaService) {}

  /* ───────────────────────────── تابلو ───────────────────────────── */

  /**
   * تابلوی کاملِ برنامه: دسته → محصول → کادر، با وضعیت و درصدِ پیشرفت.
   *
   * یک کارِ ثبت‌نشده «در انتظارِ عکس» است — لازم نیست برای هر محصول و هر کادر
   * از قبل ردیف ساخته شود؛ تابلو خودش وضعیتِ پیش‌فرض را می‌سازد.
   */
  async board(): Promise<PhotoProgramBoard> {
    const products = await this.prisma.product.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        category: { select: { slug: true, name: true } },
        images: { select: { mediaId: true, isPrimary: true, sortOrder: true } },
        photoTasks: { select: { id: true, shotKind: true, status: true, mediaId: true, note: true } },
      },
    });

    // کلیدِ فایلِ رسانه‌های پیوست‌شده — یک بار برای همه (batch، بدون N+1)
    const mediaIds = [...new Set(products.flatMap((p) => p.photoTasks.map((t) => t.mediaId).filter((m): m is string => !!m)))];
    const mediaKeys = new Map<string, string>();
    if (mediaIds.length > 0) {
      const rows = await this.prisma.media.findMany({
        where: { id: { in: mediaIds } },
        select: { id: true, storageKey: true },
      });
      for (const r of rows) mediaKeys.set(r.id, r.storageKey);
    }

    const byStatus: Record<PhotoTaskStatus, number> = {
      PENDING: 0,
      SHOT: 0,
      NEEDS_RETAKE: 0,
      APPROVED: 0,
    };

    // گروه‌بندی بر اساس دسته — ترتیبِ اولویتِ عکاسی از قرارداد می‌آید
    const groups = new Map<string, PhotoProgramCategory>();
    let productsWithArt = 0;

    for (const p of products) {
      const categorySlug = p.category?.slug ?? "";
      const spec = photoSpecForCategory(categorySlug);
      const group =
        groups.get(categorySlug) ??
        {
          slug: categorySlug,
          label: p.category?.name || spec.label,
          priority: spec.priority,
          notes: spec.notes,
          shots: spec.shots.map((s) => {
            const def = PHOTO_SHOTS.find((d) => d.kind === s.kind);
            return {
              kind: s.kind,
              label: def?.label ?? s.kind,
              spec: def?.spec ?? "",
              required: s.required,
            };
          }),
          products: [],
          done: 0,
          total: 0,
          percent: 0,
        } satisfies PhotoProgramCategory;
      groups.set(categorySlug, group);

      const primaryMediaId = p.images.find((i) => i.isPrimary)?.mediaId ?? null;
      /**
       * «آرتِ جانشین» = محصول عکسِ اصلی ندارد.
       *
       * نه «هیچ عکسی ندارد» — همان شرطی که فروشگاه برای کشیدنِ آرت می‌سنجد
       * (فقط تصویرِ primary خوانده می‌شود). محصولی که فقط عکسِ گالری دارد
       * هنوز آرت می‌کشد، پس در شمارشِ «آرت» باید بیاید.
       */
      if (!primaryMediaId) productsWithArt += 1;

      const taskByKind = new Map(p.photoTasks.map((t) => [t.shotKind, t]));
      const shots: PhotoProgramShot[] = spec.shots.map((s) => {
        const task = taskByKind.get(s.kind);
        const status: PhotoTaskStatus = task?.status ?? "PENDING";
        byStatus[status] += 1;
        const def = PHOTO_SHOTS.find((d) => d.kind === s.kind);
        const key = task?.mediaId ? mediaKeys.get(task.mediaId) : undefined;
        return {
          kind: s.kind,
          label: def?.label ?? s.kind,
          required: s.required,
          status,
          mediaId: task?.mediaId ?? null,
          mediaUrl: key ? `/api/media/${key}` : null,
          note: task?.note ?? null,
          // «زنده» یعنی همین عکس همین حالا عکسِ اصلیِ محصول در فروشگاه است
          live:
            s.kind === PRIMARY_PHOTO_SHOT &&
            status === "APPROVED" &&
            !!task?.mediaId &&
            task.mediaId === primaryMediaId,
          taskId: task?.id ?? null,
        };
      });

      const done = shots.filter((s) => s.status === "SHOT" || s.status === "APPROVED").length;
      const entry: PhotoProgramProduct = {
        id: p.id,
        slug: p.slug,
        name: p.name,
        category: categorySlug,
        categoryLabel: group.label,
        status: p.status,
        primaryImage: primaryMediaId ? (mediaKeys.get(primaryMediaId) ? `/api/media/${mediaKeys.get(primaryMediaId)}` : null) : null,
        shots,
        done,
        total: shots.length,
        percent: shots.length ? Math.round((done / shots.length) * 100) : 0,
      };
      group.products.push(entry);
      group.done += done;
      group.total += shots.length;
    }

    const categories = [...groups.values()].sort((a, b) => a.priority - b.priority || a.slug.localeCompare(b.slug, "fa"));
    for (const c of categories) c.percent = c.total ? Math.round((c.done / c.total) * 100) : 0;

    const total = categories.reduce((s, c) => s + c.total, 0);
    const done = categories.reduce((s, c) => s + c.done, 0);
    return {
      categories,
      overall: {
        done,
        total,
        percent: total ? Math.round((done / total) * 100) : 0,
        byStatus,
        productsWithArt,
        productsTotal: products.length,
      },
    };
  }

  /* ───────────────────────── چرخهٔ کار ───────────────────────── */

  /**
   * پیوستِ عکس به یک کادر — عکاس عکس را در کتابخانهٔ رسانه می‌گذارد و اینجا
   * «می‌گوید» این عکس مربوط به این کادرِ این محصول است. وضعیت به «عکس گرفته
   * شد» می‌رود؛ تا تأییدِ مدیر، عکس در سایت دیده نمی‌شود.
   */
  async attachShot(
    productId: string,
    shotKind: string,
    body: { mediaId?: string; note?: string | null },
    actorId?: string,
  ): Promise<{ taskId: string; status: PhotoTaskStatus }> {
    if (!isPhotoShotKind(shotKind)) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "کادرِ ناشناخته است." });
    }
    const mediaId = String(body?.mediaId ?? "").trim();
    if (!mediaId) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "عکسی انتخاب نشده است." });
    }
    const [product, media] = await Promise.all([
      this.prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true, name: true } }),
      this.prisma.media.findUnique({ where: { id: mediaId }, select: { id: true, kind: true, mime: true } }),
    ]);
    if (!product) {
      throw new NotFoundException({ code: "PRODUCT_NOT_FOUND", message: "محصول یافت نشد." });
    }
    if (!media) {
      throw new BadRequestException({ code: "MEDIA_NOT_FOUND", message: "فایلِ رسانه یافت نشد." });
    }
    if (media.kind !== "image" || !media.mime.startsWith("image/")) {
      throw new BadRequestException({ code: "MEDIA_TYPE", message: "فقط تصویر می‌شود پیوست کرد." });
    }
    const note = cleanNote(body?.note);
    const task = await this.prisma.photoTask.upsert({
      where: { productId_shotKind: { productId, shotKind } },
      create: { productId, shotKind, status: "SHOT", mediaId, note, actorId: actorId ?? null },
      update: { status: "SHOT", mediaId, note, actorId: actorId ?? null },
      select: { id: true, status: true },
    });
    return { taskId: task.id, status: task.status };
  }

  /**
   * تأییدِ عکس — اینجا جایگزینیِ آرت اتفاق می‌افتد.
   *
   * قاعده: «نمای صافِ جلو» عکسِ اصلیِ محصول می‌شود (عکسِ اصلیِ قبلی از حالتِ
   * اصلی خارج می‌شود ولی در گالری می‌ماند) و بقیهٔ کادرها به گالریِ محصول
   * اضافه می‌شوند. از این لحظه فروشگاه خودکار عکسِ واقعی را جای آرت می‌کشد.
   */
  async approveTask(taskId: string, actorId?: string): Promise<{ taskId: string; status: PhotoTaskStatus; live: boolean }> {
    const task = await this.prisma.photoTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        productId: true,
        shotKind: true,
        mediaId: true,
        status: true,
        product: { select: { id: true, name: true } },
      },
    });
    if (!task) {
      throw new NotFoundException({ code: "TASK_NOT_FOUND", message: "کارِ عکاسی یافت نشد." });
    }
    if (!task.mediaId) {
      throw new BadRequestException({ code: "NO_MEDIA", message: "برای این کادر عکسی ثبت نشده است." });
    }
    const media = await this.prisma.media.findUnique({ where: { id: task.mediaId }, select: { id: true } });
    if (!media) {
      throw new BadRequestException({ code: "MEDIA_NOT_FOUND", message: "فایلِ رسانه یافت نشد." });
    }

    const isPrimaryShot = task.shotKind === PRIMARY_PHOTO_SHOT;
    await this.prisma.$transaction(async (tx) => {
      await tx.photoTask.update({
        where: { id: task.id },
        data: { status: "APPROVED", actorId: actorId ?? null },
      });
      if (isPrimaryShot) {
        // عکسِ اصلیِ قبلی از حالتِ اصلی خارج می‌شود (ولی در گالری می‌ماند)
        await tx.productImage.updateMany({ where: { productId: task.productId, isPrimary: true }, data: { isPrimary: false } });
        const existing = await tx.productImage.findFirst({ where: { productId: task.productId, mediaId: task.mediaId! } });
        if (existing) {
          await tx.productImage.update({ where: { id: existing.id }, data: { isPrimary: true, sortOrder: 0, alt: task.product.name } });
        } else {
          await tx.productImage.create({
            data: { productId: task.productId, mediaId: task.mediaId!, isPrimary: true, sortOrder: 0, alt: task.product.name },
          });
        }
      } else {
        const existing = await tx.productImage.findFirst({ where: { productId: task.productId, mediaId: task.mediaId! } });
        if (!existing) {
          const max = await tx.productImage.aggregate({ where: { productId: task.productId }, _max: { sortOrder: true } });
          await tx.productImage.create({
            data: {
              productId: task.productId,
              mediaId: task.mediaId!,
              isPrimary: false,
              sortOrder: (max._max.sortOrder ?? -1) + 1,
              alt: task.product.name,
            },
          });
        }
      }
    });

    return { taskId: task.id, status: "APPROVED", live: isPrimaryShot };
  }

  /**
   * تأییدِ گروهی — همان `approveTask`، یکی پس از دیگری.
   *
   * چرا ترتیبی و نه `Promise.all`: تأییدِ «نمای صافِ جلو» عکسِ اصلیِ محصول را
   * جابه‌جا می‌کند؛ اجرای هم‌زمانِ چند کار روی یک محصول می‌تواند دو عکس را
   * هم‌زمان «اصلی» کند. ترتیبی‌بودن کندتر است ولی نتیجه قطعی است.
   *
   * چرا همه‌یا‌هیچ نیست: یک شناسهٔ کهنه (کارِ حذف‌شده، عکسِ برداشته‌شده) نباید
   * بقیهٔ کارهای سالم را برگرداند. هر کار نتیجهٔ خودش را دارد تا پنل بگوید
   * «۳ تأیید، ۱ نشد» — به‌جای سکوت یا تأییدِ نیمه‌کارهٔ بی‌خبر.
   */
  async approveMany(taskIds: unknown, actorId?: string): Promise<PhotoBulkApproveResult> {
    const ids = cleanTaskIds(taskIds);
    if (ids.length === 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "هیچ کادری انتخاب نشده است." });
    }
    if (ids.length > PHOTO_BULK_APPROVE_MAX) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: `حداکثر ${PHOTO_BULK_APPROVE_MAX} کادر در یک بار تأیید می‌شود — دستهٔ کوچک‌تری انتخاب کن.`,
      });
    }

    let approved = 0;
    let live = 0;
    const failed: Array<{ taskId: string; message: string }> = [];
    for (const id of ids) {
      try {
        const r = await this.approveTask(id, actorId);
        approved += 1;
        if (r.live) live += 1;
      } catch (e) {
        failed.push({ taskId: id, message: approvalErrorText(e) });
      }
    }
    return { approved, live, failed };
  }

  /**
   * «عکسِ دوباره» — عکسِ فعلی پذیرفته نشد.
   *
   * عکسِ ردشده از تصاویرِ محصول حذف می‌شود؛ اگر عکسِ اصلی بوده باشد، محصول
   * دوباره آرتِ جانشین را نشان می‌دهد (فروشگاه خودکار برمی‌گردد به آرت).
   */
  async retakeTask(
    taskId: string,
    body: { note?: string | null } = {},
    actorId?: string,
  ): Promise<{ taskId: string; status: PhotoTaskStatus }> {
    const task = await this.prisma.photoTask.findUnique({
      where: { id: taskId },
      select: { id: true, productId: true, mediaId: true, status: true },
    });
    if (!task) {
      throw new NotFoundException({ code: "TASK_NOT_FOUND", message: "کارِ عکاسی یافت نشد." });
    }
    const note = cleanNote(body?.note);
    await this.prisma.$transaction(async (tx) => {
      await tx.photoTask.update({
        where: { id: task.id },
        data: { status: "NEEDS_RETAKE", mediaId: null, note: note ?? null, actorId: actorId ?? null },
      });
      if (task.mediaId) {
        await tx.productImage.deleteMany({ where: { productId: task.productId, mediaId: task.mediaId } });
      }
    });
    return { taskId: task.id, status: "NEEDS_RETAKE" };
  }

  /** برچسب‌های وضعیت — تا پنل و API یک واژگان داشته باشند */
  static get statusLabels(): Record<PhotoTaskStatus, string> {
    return PHOTO_STATUS_LABELS;
  }

  /** فهرست وضعیت‌های معتبر — برای اعتبارسنجی سمت کلاینت */
  static get statuses(): readonly PhotoTaskStatus[] {
    return PHOTO_TASK_STATUSES;
  }
}

/** شناسه‌های تأییدِ گروهی — رشته‌های تمیز، بی‌تکرار، به ترتیبِ ورود */
function cleanTaskIds(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const id = v.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * متنِ خطای یک کار — پیامِ فارسیِ خودِ سرویس، نه متنِ خامِ Prisma.
 * (کاربر باید بداند «عکسی ثبت نشده است»، نه نامِ جدول.)
 */
function approvalErrorText(e: unknown): string {
  const body = (e as { getResponse?: () => unknown })?.getResponse?.();
  if (body && typeof body === "object" && "message" in body) {
    const msg = (body as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  if (e instanceof Error && e.message.trim()) return e.message;
  return "تأیید نشد؛ بعداً دوباره تلاش کن.";
}

/** یادداشتِ کوتاه و تمیز — بیش از ۴۰۰ کاراکتر، بی‌فایده */
function cleanNote(note: string | null | undefined): string | null {
  const v = String(note ?? "").trim();
  if (!v) return null;
  return v.slice(0, 400);
}

/** نوعِ کادر — برای استفادهٔ بیرونی از سرویس */
export type { PhotoShotKind };
