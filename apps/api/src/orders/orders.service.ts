import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { InventoryService } from "../inventory/inventory.service";
import { PricingService } from "../pricing/pricing.service";
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
    private readonly pricing: PricingService,
  ) {}

  /** قیمت مؤثر سطح کانال — فقط سرور تعیین می‌کند (بند ۱۲) — delegate به Pricing Domain */
  async effectivePrice(variantSku: string, channelSlug: string): Promise<{ price: bigint; salePrice: bigint | null }> {
    const r = await this.pricing.effectivePrice(variantSku, channelSlug);
    return { price: r.price, salePrice: r.salePrice };
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
        items: { select: { titleSnapshot: true, qty: true, unitPrice: true, lineTotal: true, variant: { select: { sku: true } } } },
        shipments: { select: { id: true, trackingCode: true, status: true, provider: true } },
      },
    });
  }

  // ---------------- فاز ۱۴ بند ۶: ویرایش حرفه‌ای سفارش ----------------
  /**
   * ویرایش سفارش پرداخت‌نشده (بند ۱۷ Master):
   * - فقط PENDING/CANCELLED نیست؛ PAID → ممنوع (مالی immutable — از مرجوعی برو)
   * - خطوط: افزودن/حذف/تغییر تعداد — قیمت از سرور دوباره محاسبه می‌شود (هرگز از کلاینت)
   * - رزرو انبار: آزادسازی قدیم + رزرو جدید با اعتبارسنجی موجودی — اتمیک
   * - تاریخچه بازبینی: OrderEvent type=ORDER_EDITED با diff کامل (قبل/بعد)
   * - رویداد Outbox → ادمین مطلع شود
   */
  async editOrder(input: {
    orderId: string; actorId?: string; reason?: string;
    lines?: Array<{ sku: string; qty: number }>; // در صورت ارسال → جایگزینی کامل خطوط
    guestName?: string; guestMobile?: string;
    address?: CheckoutInput["address"];
    shippingMethodId?: string;
  }) {
    const order = await this.prisma.order.findUnique({
      where: { id: input.orderId },
      include: { items: true, channel: { select: { slug: true, defaultWarehouseId: true } } },
    });
    if (!order) throw new NotFoundException({ code: "NOT_FOUND", message: "سفارش یافت نشد." });
    if (order.paymentStatus === "PAID") {
      throw new BadRequestException({ code: "ORDER_PAID", message: "سفارش پرداخت‌شده قابل ویرایش نیست؛ از مرجوعی استفاده کنید." });
    }
    if (order.status === "CANCELLED") {
      throw new BadRequestException({ code: "ORDER_CANCELLED", message: "سفارش لغوشده قابل ویرایش نیست." });
    }
    if (order.status === "SHIPPED" || order.status === "DELIVERED") {
      throw new BadRequestException({ code: "ORDER_SHIPPED", message: "سفارش ارسال‌شده قابل ویرایش نیست." });
    }

    const channelSlug = order.channel?.slug ?? "website";
    const warehouseId = order.warehouseId ?? order.channel?.defaultWarehouseId ?? "";
    if (!warehouseId) throw new BadRequestException({ code: "NO_WAREHOUSE", message: "انبار سفارش مشخص نیست." });

    // snapshot قبل (برای diff)
    const skuById = new Map((await this.prisma.productVariant.findMany({ where: { id: { in: order.items.map((it) => it.variantId).filter((x): x is string => !!x) } }, select: { id: true, sku: true } })).map((v) => [v.id, v.sku]));
    const before = {
      lines: order.items.map((it) => ({ sku: (it.variantId ? skuById.get(it.variantId) : null) ?? "", title: it.titleSnapshot, qty: it.qty, unitPrice: Number(it.unitPrice), lineTotal: Number(it.lineTotal) })),
      guestName: order.guestName,
      guestMobile: order.guestMobile,
      address: order.addressSnapshot,
      shippingMethodId: (order.shippingMethodSnapshot as { id?: string } | null)?.id ?? null,
      subtotal: Number(order.subtotal), shippingCost: Number(order.shippingCost), discountTotal: Number(order.discountTotal), total: Number(order.total),
    };

    // --- خطوط جدید (یا همان قبلی) — قیمت از سرور ---
    const nextLinesRaw = input.lines ?? before.lines.map((l) => ({ sku: l.sku, qty: l.qty }));
    if (!Array.isArray(nextLinesRaw) || nextLinesRaw.length === 0) {
      throw new BadRequestException({ code: "CART_EMPTY", message: "حداقل یک ردیف لازم است." });
    }
    const merged = new Map<string, number>();
    for (const l of nextLinesRaw) {
      if (!Number.isSafeInteger(l.qty) || l.qty <= 0 || l.qty > 99) {
        throw new BadRequestException({ code: "VALIDATION_ERROR", message: `تعداد نامعتبر برای ${l.sku}.` });
      }
      merged.set(l.sku, (merged.get(l.sku) ?? 0) + l.qty);
    }

    const priced: Array<{ sku: string; qty: number; unit: bigint }> = [];
    let subtotal = 0n;
    for (const [sku, qty] of merged) {
      const { price, salePrice } = await this.effectivePrice(sku, channelSlug);
      const unit = salePrice ?? price;
      subtotal += unit * BigInt(qty);
      priced.push({ sku, qty, unit });
    }

    // --- ارسال (اگر تغییر کرده یا خطوط عوض شده‌اند → هزینه دوباره) ---
    let method = await this.prisma.shippingMethod.findUnique({
      where: { id: (input.shippingMethodId ?? before.shippingMethodId) ?? "" },
    });
    if (!method || method.status !== "active") {
      method = await this.prisma.shippingMethod.findFirst({ where: { status: "active" } });
    }
    if (!method) throw new BadRequestException({ code: "SHIPPING_INVALID", message: "روش ارسال فعال یافت نشد." });
    const shippingCost = method.freeOverAmount != null && subtotal >= method.freeOverAmount ? 0n : method.cost;

    // تخفیف سفارش قبلی (کوپن) حفظ نمی‌شود — ویرایش = قیمت‌گذاری تازه؛ کوپن باید دوباره اعمال شود (صادقانه‌تر)
    const discountTotal = 0n;
    const total = subtotal + shippingCost - discountTotal;

    // --- آدرس/مشتری (در صورت ارسال) ---
    const addressSnapshot = input.address
      ? ({ ...input.address, fullName: input.guestName ?? before.guestName, mobile: input.guestMobile ?? before.guestMobile } as object)
      : (order.addressSnapshot as object);

    const updated = await this.prisma.$transaction(async (tx) => {
      // قفل واریانت‌ها
      for (const line of priced) {
        await tx.$queryRaw`SELECT "sku" FROM "ProductVariant" WHERE "sku" = ${line.sku} FOR UPDATE`;
      }

      // اعتبارسنجی موجودی برای افزودنی‌ها (تفاوت با رزرو فعال فعلی)
      for (const line of priced) {
        const agg = await tx.stockLedgerEntry.aggregate({
          where: { warehouseId, variantSku: line.sku },
          _sum: { qtyIn: true, qtyOut: true },
        });
        const onHand = (agg._sum.qtyIn ?? 0) - (agg._sum.qtyOut ?? 0);
        const active = await tx.stockReservation.aggregate({
          where: { warehouseId, variantSku: line.sku, state: "ACTIVE", refId: { not: order.id } },
          _sum: { qty: true },
        });
        if (onHand - (active._sum.qty ?? 0) < line.qty) {
          throw new BadRequestException({ code: "INSUFFICIENT_STOCK", message: `موجودی «${line.sku}» کافی نیست.` });
        }
      }

      // آزادسازی رزروهای قدیم سفارش
      const oldRes = await tx.stockReservation.findMany({ where: { refType: "order", refId: order.id, state: "ACTIVE" } });
      await tx.stockReservation.updateMany({ where: { refType: "order", refId: order.id, state: "ACTIVE" }, data: { state: "RELEASED" } });

      // حذف خطوط قدیم و نوشتن جدید
      await tx.orderItem.deleteMany({ where: { orderId: order.id } });
      for (const line of priced) {
        const variant = await tx.productVariant.findUniqueOrThrow({
          where: { sku: line.sku },
          include: { product: { select: { name: true } } },
        });
        await tx.orderItem.create({
          data: {
            orderId: order.id,
            variantId: variant.id,
            titleSnapshot: variant.product.name,
            qty: line.qty,
            unitPrice: line.unit,
            lineTotal: line.unit * BigInt(line.qty),
          },
        });
      }

      // رزرو جدید
      for (const line of priced) {
        await tx.stockReservation.create({
          data: {
            warehouseId,
            variantSku: line.sku,
            qty: line.qty,
            refType: "order",
            refId: order.id,
            expiresAt: new Date(Date.now() + RESERVATION_TTL_MINUTES * 60_000),
          },
        });
      }
      // reservedQty واریانت‌ها: اول آزادسازی قدیم، بعد رزرو جدید
      const touchedSkus = new Set([...oldRes.map((r) => r.variantSku), ...priced.map((p) => p.sku)]);
      for (const sku of touchedSkus) {
        const oldQty = oldRes.filter((r) => r.variantSku === sku).reduce((a, r) => a + r.qty, 0);
        const newQty = priced.filter((p) => p.sku === sku).reduce((a, p) => a + p.qty, 0);
        if (oldQty === newQty) continue;
        const v = await tx.productVariant.findUnique({ where: { sku } });
        if (!v) continue;
        await tx.productVariant.update({ where: { sku }, data: { reservedQty: Math.max(0, v.reservedQty - oldQty + newQty) } });
      }

      const upd = await tx.order.update({
        where: { id: order.id },
        data: {
          guestName: input.guestName ?? order.guestName,
          guestMobile: input.guestMobile ?? order.guestMobile,
          addressSnapshot,
          shippingMethodSnapshot: { id: method.id, name: method.name, cost: Number(method.cost) } as object,
          subtotal,
          shippingCost,
          discountTotal,
          total,
        },
      });

      // تاریخچه بازبینی — diff کامل در OrderEvent (بند ۱۷: revision history)
      const after = {
        lines: priced.map((p) => ({ sku: p.sku, qty: p.qty, unitPrice: Number(p.unit), lineTotal: Number(p.unit * BigInt(p.qty)) })),
        guestName: upd.guestName,
        guestMobile: upd.guestMobile,
        address: upd.addressSnapshot,
        shippingMethodId: method.id,
        subtotal: Number(subtotal), shippingCost: Number(shippingCost), discountTotal: 0, total: Number(total),
      };
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: "ORDER_EDITED",
          payload: {
            actorId: input.actorId ?? null,
            reason: input.reason ?? null,
            before,
            after,
          } as object,
          idempotencyKey: `edit:${order.id}:${Date.now()}`, // هر ویرایش رویداد مستقل
        },
      });
      return upd;
    });

    await this.prisma.domainEventOutbox.create({
      data: { name: "OrderEdited", payload: { orderId: order.id, orderCode: order.code, total: Number(total), actorId: input.actorId ?? null } as object },
    }).catch(() => null);

    return { id: updated.id, code: updated.code, total: updated.total, subtotal: updated.subtotal, shippingCost: updated.shippingCost };
  }

  /** تاریخچهٔ بازبینی سفارش — برای UI */
  async orderRevisions(orderId: string) {
    const events = await this.prisma.orderEvent.findMany({
      where: { orderId, type: { in: ["ORDER_EDITED", "STATUS_CHANGED"] } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return { items: events };
  }
}
