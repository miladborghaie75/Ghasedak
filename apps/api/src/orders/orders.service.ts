import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { InventoryService } from "../inventory/inventory.service";
import { nextNumber } from "../common/number-series";

/**
 * سفارش — بند ۱۶/۱۷/۵۱: ایجاد سرور-محور با snapshot کامل، رزرو انبار اتمیک.
 * قیمت/موجودی هرگز از کلاینت پذیرفته نمی‌شود (بند ۵۱)؛ snapshot تاریخی سفارش
 * از تغییر قیمت آینده مستقل است (بند ۱۳).
 */

export interface CheckoutLineInput {
  sku: string;
  qty: number;
}

export interface CheckoutInput {
  guestName: string;
  guestMobile: string;
  address: {
    province: string;
    city: string;
    address: string;
    plaque: string;
    unit?: string;
    postalCode: string;
  };
  shippingMethodId: string;
  couponCode?: string | null;
  lines: CheckoutLineInput[];
  idempotencyKey?: string;
}

export interface ChannelPricing {
  channelSlug: string;
  warehouseId: string;
}

export const RESERVATION_TTL_MINUTES = 120;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  /** قیمت مؤثر سطح کانال — فقط سرور تعیین می‌کند (بند ۱۲) */
  async effectivePrice(variantSku: string, channelSlug: string): Promise<{ price: bigint; salePrice: bigint | null }> {
    const level = await this.prisma.salesChannel.findUnique({
      where: { slug: channelSlug },
      select: { priceLevelId: true },
    });
    const variant = await this.prisma.productVariant.findUnique({ where: { sku: variantSku } });
    if (!variant || variant.status !== "PUBLISHED") {
      throw new NotFoundException({ code: "VARIANT_NOT_FOUND", message: "کالا یافت نشد یا غیرفعال است." });
    }
    if (level) {
      const vp = await this.prisma.variantPrice.findUnique({
        where: { variantSku_priceLevelId: { variantSku, priceLevelId: level.priceLevelId } },
      });
      if (vp) {
        const now = new Date();
        const saleActive =
          vp.salePrice != null &&
          (!vp.saleStartsAt || vp.saleStartsAt <= now) &&
          (!vp.saleEndsAt || vp.saleEndsAt >= now);
        return { price: vp.price, salePrice: saleActive ? vp.salePrice : null };
      }
    }
    return { price: variant.price, salePrice: variant.salePrice };
  }

  /** ایجاد سفارش مهمان — اتمیک: رزرو + سفارش + items + snapshot (بند ۹۲) */
  async createGuestOrder(input: CheckoutInput): Promise<{ code: string; total: bigint; id: string }> {
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
      throw new BadRequestException({ code: "CART_EMPTY", message: "سبد خرید خالی است." });
    }
    for (const l of input.lines) {
      if (!Number.isSafeInteger(l.qty) || l.qty <= 0 || l.qty > 99) {
        throw new BadRequestException({ code: "VALIDATION_ERROR", message: "تعداد نامعتبر است." });
      }
    }
    if (!/^09\d{9}$/.test(input.guestMobile)) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "موبایل نامعتبر است." });
    }

    // ادغام خط تکراری (اسکن دوباره = افزایش تعداد، بند ۷)
    const merged = new Map<string, number>();
    for (const l of input.lines) merged.set(l.sku, (merged.get(l.sku) ?? 0) + l.qty);

    const channel = await this.prisma.salesChannel.findUnique({ where: { slug: "website" } });
    if (!channel || !channel.active) {
      throw new BadRequestException({ code: "CHANNEL_INACTIVE", message: "کانال فروش فعال نیست." });
    }
    const method = await this.prisma.shippingMethod.findUnique({ where: { id: input.shippingMethodId } });
    if (!method || method.status !== "active") {
      throw new BadRequestException({ code: "SHIPPING_INVALID", message: "روش ارسال نامعتبر است." });
    }

    // قیمت مؤثر هر خط از DB (هرگز از کلاینت)
    const priced: Array<{ sku: string; qty: number; unit: bigint }> = [];
    let subtotal = 0n;
    for (const [sku, qty] of merged) {
      const { price, salePrice } = await this.effectivePrice(sku, "website");
      const unit = (salePrice ?? price);
      subtotal += unit * BigInt(qty);
      priced.push({ sku, qty, unit });
    }

    // ارسال — قاعده رایگان خود متد (بند ۳۰)
    const shippingCost =
      method.freeOverAmount != null && subtotal >= method.freeOverAmount ? 0n : method.cost;
    let total = subtotal + shippingCost;

    // کد تخفیف سرور-محور (بند ۱۵) — درصدی/مبلغی با سقف و حداقل سبد
    let discount = 0n;
    let couponId: string | null = null;
    if (input.couponCode) {
      const coupon = await this.prisma.coupon.findUnique({ where: { code: input.couponCode.toUpperCase() } });
      const now = new Date();
      const valid =
        coupon &&
        coupon.active &&
        (!coupon.startsAt || coupon.startsAt <= now) &&
        (!coupon.endsAt || coupon.endsAt >= now) &&
        (coupon.minCartTotal == null || subtotal >= coupon.minCartTotal) &&
        (coupon.usageLimit == null ||
          (await this.prisma.couponRedemption.count({ where: { couponId: coupon.id } })) < coupon.usageLimit);
      if (!valid) {
        throw new BadRequestException({ code: "COUPON_INVALID", message: "کد تخفیف معتبر نیست." });
      }
      couponId = coupon.id;
      if (coupon.type === "percent") {
        discount = (subtotal * BigInt(coupon.amount)) / 100n;
        if (coupon.maxDiscount != null && discount > coupon.maxDiscount) discount = coupon.maxDiscount;
      } else {
        discount = coupon.amount;
        if (discount > subtotal) discount = subtotal;
      }
      total -= discount;
    }

    const idem = input.idempotencyKey;
    if (idem) {
      const existing = await this.prisma.order.findUnique({ where: { idempotencyKey: idem } });
      if (existing) return { code: existing.code, total: existing.total, id: existing.id };
    }

    // رزرو انبار قبل از ساخت سفارش (بند ۱۴) — داخل همان جریان؛ خطا → هیچ رکوردی نمانده
    const addressSnapshot = {
      ...input.address,
      fullName: input.guestName,
      mobile: input.guestMobile,
    };

    const order = await this.prisma.$transaction(async (tx) => {
      for (const line of priced) {
        await tx.$queryRaw`SELECT "sku" FROM "ProductVariant" WHERE "sku" = ${line.sku} FOR UPDATE`;
      }
      for (const line of priced) {
        const agg = await tx.stockLedgerEntry.aggregate({
          where: { warehouseId: channel.defaultWarehouseId, variantSku: line.sku },
          _sum: { qtyIn: true, qtyOut: true },
        });
        const onHand = (agg._sum.qtyIn ?? 0) - (agg._sum.qtyOut ?? 0);
        const active = await tx.stockReservation.aggregate({
          where: { warehouseId: channel.defaultWarehouseId, variantSku: line.sku, state: "ACTIVE" },
          _sum: { qty: true },
        });
        if (onHand - (active._sum.qty ?? 0) < line.qty) {
          throw new BadRequestException({ code: "INSUFFICIENT_STOCK", message: `موجودی «${line.sku}» کافی نیست.` });
        }
      }

      const code = await nextNumber(tx, "order", "ORD", 6);
      const created = await tx.order.create({
        data: {
          code,
          channelId: channel.id,
          warehouseId: channel.defaultWarehouseId,
          guestName: input.guestName,
          guestMobile: input.guestMobile,
          addressSnapshot: addressSnapshot as object,
          status: "PENDING",
          paymentStatus: "PENDING",
          subtotal,
          shippingCost,
          discountTotal: discount,
          total,
          ...(idem ? { idempotencyKey: idem } : {}),
          items: {
            create: await Promise.all(
              priced.map(async (line) => {
                const variant = await tx.productVariant.findUniqueOrThrow({
                  where: { sku: line.sku },
                  include: { product: { select: { name: true, slug: true } } },
                });
                return {
                  variantId: variant.id,
                  titleSnapshot: variant.product.name,
                  qty: line.qty,
                  unitPrice: line.unit,
                  lineTotal: line.unit * BigInt(line.qty),
                };
              }),
            ),
          },
        },
      });

      // redemption کوپن — جدا از create سفارش تا input کست checked/unchecked مبهم نشود
      if (couponId) {
        await tx.couponRedemption.create({
          data: { couponId, orderId: created.id, mobile: input.guestMobile },
        });
      }

      // رزرو با TTL (بند ۱۴) — پس از ثبت سفارش در همان تراکنش
      for (const line of priced) {
        await tx.stockReservation.create({
          data: {
            warehouseId: channel.defaultWarehouseId,
            variantSku: line.sku,
            qty: line.qty,
            refType: "order",
            refId: created.id,
            expiresAt: new Date(Date.now() + RESERVATION_TTL_MINUTES * 60_000),
          },
        });
      }
      for (const line of priced) {
        const v = await tx.productVariant.findUniqueOrThrow({ where: { sku: line.sku } });
        await tx.productVariant.update({
          where: { sku: line.sku },
          data: { reservedQty: v.reservedQty + line.qty },
        });
      }
      return created;
    });

    await this.prisma.orderStatusHistory.create({
      data: { orderId: order.id, toStatus: "PENDING", note: "ثبت سفارش مهمان" },
    });

    // رویداد Outbox → زنگ ادمین (worker event bus) — بند ۴۳
    await this.prisma.domainEventOutbox
      .create({
        data: {
          name: "OrderCreated",
          payload: { orderId: order.id, orderCode: order.code, total: Number(order.total) } as object,
        },
      })
      .catch(() => null); // تکراری — idempotent

    return { code: order.code, total: order.total, id: order.id };
  }

  /** کنسل سفارش پرداخت‌نشده → آزادسازی رزرو (بند ۱۴/۱۷) */
  async cancelUnpaid(id: string, actorId?: string): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException({ code: "NOT_FOUND", message: "سفارش یافت نشد." });
    if (order.paymentStatus === "PAID") {
      throw new BadRequestException({ code: "ORDER_PAID", message: "سفارش پرداخت‌شده قابل کنسل ساده نیست؛ از مرجوعی استفاده کنید." });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.stockReservation.updateMany({
        where: { refId: order.id, state: "ACTIVE" },
        data: { state: "RELEASED" },
      });
      await tx.order.update({
        where: { id: order.id },
        data: { status: "CANCELLED" },
      });
      await tx.orderStatusHistory.create({
        data: { orderId: order.id, fromStatus: order.status, toStatus: "CANCELLED", actorId, note: "کنسل سفارش پرداخت‌نشده" },
      });
    });
  }

  async list(query: { page?: number; limit?: number; status?: string }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const where = {
      ...(query.status ? { status: query.status as never } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, code: true, status: true, paymentStatus: true, total: true,
          subtotal: true, shippingCost: true, discountTotal: true,
          guestName: true, guestMobile: true, createdAt: true,
          channel: { select: { name: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async byCode(code: string) {
    return this.prisma.order.findUnique({
      where: { code },
      include: {
        items: { select: { titleSnapshot: true, qty: true, unitPrice: true, lineTotal: true } },
        shipments: { select: { id: true, trackingCode: true, status: true, provider: true } },
      },
    });
  }
}
