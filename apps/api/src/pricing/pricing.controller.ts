import { BadRequestException, Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RequirePermission } from "../auth/permissions.guard";
import { Identity } from "../auth/identity.decorator";
import { PricingService } from "./pricing.service";

/**
 * Pricing API — بند ۱۵/۱۲۲:
 * - تغییر قیمت: pricing.manage (جدید در seed) + قید per-level از PriceLevel.restriction.adminRoles
 *   (سطح می‌تواند فهرست نقش‌های مجاز داشته باشد — پیش‌فرض: باز برای pricing.manage).
 * - مشاهده تاریخچه/سطوح/کانال‌ها: pricing.view.
 * - فید کانال (Torob/SnappPay): فقط قیمت همان کانال + موجودی مرکزی؛ بدون cost/سطح دیگر.
 * - quote عمومی: فقط slug کانال؛ شناسه کانال سمت سرور حل می‌شود (نه Referer — بند ۱۵).
 */
@Controller()
export class PricingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly prisma: PrismaService,
  ) {}

  // ---------- ادمین ----------
  @Get("admin/pricing/levels")
  @RequirePermission("pricing.view")
  async levels() {
    const items = await this.prisma.priceLevel.findMany({
      orderBy: { sortOrder: "asc" },
      include: { channels: { select: { slug: true, name: true, active: true } } },
    });
    return { items };
  }

  @Get("admin/pricing/variants")
  @RequirePermission("pricing.view")
  async variants(@Query() q: { q?: string; level?: string; page?: string }) {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = 30;
    const level = q.level
      ? await this.prisma.priceLevel.findUnique({ where: { code: q.level } })
      : null;
    const where = {
      status: "PUBLISHED" as const,
      product: { deletedAt: null },
      ...(q.q ? { OR: [{ sku: { contains: q.q } }, { barcode: { contains: q.q } }, { product: { name: { contains: q.q } } }] } : {}),
    };
    const [variants, total] = await this.prisma.$transaction([
      this.prisma.productVariant.findMany({
        where,
        include: {
          product: { select: { name: true } },
          prices: level ? { where: { priceLevelId: level.id } } : true,
        },
        orderBy: { sku: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.productVariant.count({ where }),
    ]);
    return {
      items: variants.map((v) => {
        const vp = Array.isArray(v.prices) ? v.prices[0] : null;
        return {
          sku: v.sku,
          barcode: v.barcode,
          productName: v.product?.name ?? "",
          basePrice: v.price,
          baseSalePrice: v.salePrice,
          levelPrice: vp?.price ?? null,
          levelSalePrice: vp?.salePrice ?? null,
          saleStartsAt: vp?.saleStartsAt ?? null,
          saleEndsAt: vp?.saleEndsAt ?? null,
        };
      }),
      total,
      page,
      limit,
    };
  }

  @Post("admin/pricing/change")
  @RequirePermission("pricing.manage")
  async change(
    @Body()
    body: {
      skus: string[];
      levelCode: string;
      mode: "absolute" | "percent" | "delta";
      amount: number;
      salePrice?: number | null;
      clearSale?: boolean;
      reason?: string;
    },
    @Identity() actor?: { userId: string; role: string },
  ) {
    await this.assertLevelAllowed(body.levelCode, actor?.role);
    return this.pricing.changePrice({
      ...body,
      actorId: actor?.userId,
      source: "admin",
    });
  }

  @Get("admin/pricing/history/:sku")
  @RequirePermission("pricing.view")
  history(@Param("sku") sku: string, @Query() q: { level?: string }) {
    const levelCode = q.level ?? "WEB";
    return this.pricing.history(sku, levelCode);
  }

  /** قید per-level: PriceLevel.restriction.adminRoles (بند ۱۵) — منطق واحد برای همه مسیرها */
  private async assertLevelAllowed(levelCode: string, role?: string) {
    const level = await this.prisma.priceLevel.findUnique({ where: { code: levelCode } });
    if (!level) throw new BadRequestException({ code: "LEVEL_INVALID", message: "سطح قیمت نامعتبر است." });
    const restriction = (level.restriction ?? {}) as { adminRoles?: string[] };
    if (Array.isArray(restriction.adminRoles) && restriction.adminRoles.length > 0) {
      if (!role || !restriction.adminRoles.includes(role)) {
        throw new BadRequestException({
          code: "LEVEL_FORBIDDEN",
          message: "نقش شما برای تغییر این سطح قیمت مجاز نیست.",
        });
      }
    }
  }

  // ---------- عمومی (فروشگاه/کانال‌ها) ----------
  @Get("public/pricing/channels")
  channels() {
    return this.pricing.publicChannels();
  }

  @Get("public/pricing/feed/:channel")
  feed(@Param("channel") channel: string, @Query() q: { page?: string; limit?: string }) {
    return this.pricing.channelFeed(channel, q);
  }

  @Get("public/pricing/quote")
  async quote(@Query() q: { sku?: string; channel?: string }) {
    if (!q.sku) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "sku الزامی است." });
    }
    const channelSlug = q.channel ?? "website"; // پیش‌فرض صریح — نه Referer (بند ۱۵)
    const r = await this.pricing.effectivePrice(q.sku, channelSlug);
    return { sku: r.sku, price: r.price, salePrice: r.salePrice };
  }
}
