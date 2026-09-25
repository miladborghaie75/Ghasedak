import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EventBusService } from "../events/event-bus.service";

/**
 * Pricing Domain — بند ۱۲/۱۳/۱۵ Master — روی مدل‌های موجود، بدون سیستم موازی:
 * - PriceLevel/VariantPrice/SalesChannel موجود = منبع حقیقت قیمت کانال‌محور.
 * - PriceHistory موجود = ledger تغییر قیمت؛ هر تغییر (تکی/گروهی) اینجا رکورد می‌گیرد
 *   با actor/source/reason/time — هیچ محاسبه‌ای از history خوانده نمی‌شود (بند ۱۳).
 * - effectivePrice متمرکز: Orders/POS قبلاً همین منطق را تکراری داشتند — حالا همه
 *   از همین سرویس می‌خوانند (بند ۶: Pricing Domain = Source of Truth).
 * - Who can change: price:manage سراسری + قید per-level از PriceLevel.restriction.adminRoles.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBusService,
  ) {}

  /** قیمت مؤثر یک واریانت در یک کانال — منبع واحد برای storefront/POS/integration */
  async effectivePrice(variantSku: string, channelSlug: string) {
    const variant = await this.prisma.productVariant.findUnique({ where: { sku: variantSku } });
    if (!variant || variant.status !== "PUBLISHED") {
      throw new NotFoundException({ code: "VARIANT_NOT_FOUND", message: "کالا یافت نشد یا غیرفعال است." });
    }
    const channel = await this.prisma.salesChannel.findUnique({ where: { slug: channelSlug } });
    if (!channel || !channel.active) {
      throw new BadRequestException({ code: "CHANNEL_INACTIVE", message: "کانال فعال نیست." });
    }
    const now = new Date();
    const vp = await this.prisma.variantPrice.findUnique({
      where: { variantSku_priceLevelId: { variantSku, priceLevelId: channel.priceLevelId } },
    });
    if (vp) {
      const saleActive =
        vp.salePrice != null &&
        (!vp.saleStartsAt || vp.saleStartsAt <= now) &&
        (!vp.saleEndsAt || vp.saleEndsAt >= now);
      return { sku: variantSku, channel: channelSlug, price: vp.price, salePrice: saleActive ? vp.salePrice : null };
    }
    // fallback: قیمت پایه واریانت (رفتار فعلی، حفظ شده)
    return { sku: variantSku, channel: channelSlug, price: variant.price, salePrice: variant.salePrice };
  }

  /** واریانت‌های یک کانال (فید Torob/SnappPay و…) — فقط قیمت همان کانال، بدون cost */
  async channelFeed(channelSlug: string, q: { page?: string; limit?: string }) {
    const channel = await this.prisma.salesChannel.findUnique({ where: { slug: channelSlug } });
    if (!channel || !channel.active) {
      throw new BadRequestException({ code: "CHANNEL_INACTIVE", message: "کانال فعال نیست." });
    }
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(q.limit ?? 100)));
    const variants = await this.prisma.productVariant.findMany({
      where: { status: "PUBLISHED", product: { deletedAt: null } },
      include: {
        product: { select: { name: true, slug: true, images: { take: 1, orderBy: { sortOrder: "asc" } } } },
        prices: { where: { priceLevelId: channel.priceLevelId } },
      },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { sku: "asc" },
    });
    const now = new Date();
    return {
      channel: { slug: channel.slug, name: channel.name },
      page,
      limit,
      items: variants.map((v) => {
        const vp = v.prices[0];
        const saleActive =
          vp?.salePrice != null &&
          (!vp?.saleStartsAt || vp.saleStartsAt <= now) &&
          (!vp?.saleEndsAt || vp.saleEndsAt >= now);
        return {
          sku: v.sku,
          barcode: v.barcode,
          product: v.product?.name ?? "",
          slug: v.product?.slug ?? "",
          price: vp ? vp.price : v.price,
          salePrice: vp ? (saleActive ? vp.salePrice : null) : v.salePrice,
          stock: v.stockQty, // موجودی واقعی انبار مرکزی (بند ۱۰۱: کانال‌ها از یک منبع)
        };
      }),
    };
  }

  /** تغییر قیمت تکی/گروهی + رکورد PriceHistory + رویداد PriceChanged */
  async changePrice(input: {
    skus: string[];
    levelCode: string;
    mode: "absolute" | "percent" | "delta";
    amount: number;
    salePrice?: number | null;
    clearSale?: boolean;
    reason?: string;
    actorId?: string;
    source?: string;
  }) {
    if (!Array.isArray(input.skus) || input.skus.length === 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "حداقل یک کالا انتخاب کنید." });
    }
    const level = await this.prisma.priceLevel.findUnique({ where: { code: input.levelCode } });
    if (!level || !level.active) {
      throw new BadRequestException({ code: "LEVEL_INVALID", message: "سطح قیمت نامعتبر است." });
    }
    if (input.mode === "absolute" && (!Number.isSafeInteger(input.amount) || input.amount < 0)) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "قیمت باید عدد صحیح نامنفی باشد." });
    }
    if (input.mode === "percent" && (!Number.isSafeInteger(input.amount) || input.amount < -90 || input.amount > 100)) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "درصد باید بین -۹۰ تا ۱۰۰ باشد." });
    }
    if (input.mode === "delta" && (!Number.isSafeInteger(input.amount) || input.amount === 0)) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "مبلغ تغییر باید عدد صحیح غیرصفر باشد." });
    }

    const results = await this.prisma.$transaction(async (tx) => {
      const out: Array<{ sku: string; oldPrice: number; newPrice: number }> = [];
      for (const sku of input.skus) {
        const variant = await tx.productVariant.findUnique({ where: { sku } });
        if (!variant) continue;
        const vp = await tx.variantPrice.findUnique({
          where: { variantSku_priceLevelId: { variantSku: sku, priceLevelId: level.id } },
        });
        const oldPrice = Number(vp?.price ?? variant.price);

        let newPrice: number;
        if (input.mode === "absolute") newPrice = input.amount;
        else if (input.mode === "percent") newPrice = Math.round((oldPrice * (100 + input.amount)) / 100);
        else newPrice = oldPrice + input.amount;
        newPrice = Math.max(0, newPrice);

        const data: Record<string, unknown> = { price: BigInt(newPrice) };
        if (input.clearSale) {
          data.salePrice = null;
          data.saleStartsAt = null;
          data.saleEndsAt = null;
        } else if (input.salePrice != null) {
          if (!Number.isSafeInteger(input.salePrice) || input.salePrice < 0 || input.salePrice > newPrice) {
            throw new BadRequestException({
              code: "SALE_PRICE_INVALID",
              message: `قیمت فروش ویژه «${sku}» باید عدد صحیح بین ۰ تا قیمت جدید باشد.`,
            });
          }
          data.salePrice = BigInt(input.salePrice);
        }

        if (vp) {
          await tx.variantPrice.update({ where: { id: vp.id }, data });
        } else {
          await tx.variantPrice.create({
            data: {
              variantSku: sku,
              priceLevelId: level.id,
              ...(data as { price: bigint; salePrice?: bigint | null }),
            },
          });
        }

        if (newPrice !== oldPrice) {
          await tx.priceHistory.create({
            data: {
              variantSku: sku,
              priceLevelId: level.id,
              oldPrice: BigInt(oldPrice),
              newPrice: BigInt(newPrice),
              reason: input.reason ?? null,
              actorId: input.actorId ?? null,
            },
          });
        }
        out.push({ sku, oldPrice, newPrice });
      }
      return out;
    });

    await this.bus.publish("PriceChanged", {
      level: level.code,
      count: results.length,
      actorId: input.actorId ?? null,
      source: input.source ?? "admin",
      reason: input.reason ?? null,
    });

    return { level: level.code, changed: results.length, items: results };
  }

  /** تاریخچه قیمت یک واریانت در یک سطح (بند ۱۳: فقط نمایش) */
  async history(variantSku: string, levelCode: string) {
    const level = await this.prisma.priceLevel.findUnique({ where: { code: levelCode } });
    if (!level) throw new NotFoundException({ code: "NOT_FOUND", message: "سطح قیمت یافت نشد." });
    const items = await this.prisma.priceHistory.findMany({
      where: { variantSku, priceLevelId: level.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { variant: { select: { product: { select: { name: true } } } } },
    });
    return { items: items.map((h) => ({ ...h, productName: h.variant.product?.name })) };
  }

  /** کانال‌های عمومی — برای UI (فقط slug/name/type؛ بدون هیچ داده حساس) */
  async publicChannels() {
    const channels = await this.prisma.salesChannel.findMany({
      where: { active: true },
      orderBy: { createdAt: "asc" },
      select: { slug: true, name: true, type: true },
    });
    return { items: channels };
  }
}
