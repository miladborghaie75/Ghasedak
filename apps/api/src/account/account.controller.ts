import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Body,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { Identity } from "../auth/identity.decorator";
import { RequireCsrf } from "../auth/csrf.guard";
import type { AdminIdentity } from "../auth/auth.service";

/**
 * «حساب من» در فروشگاه — فقط دادهٔ خودِ مشتری (گام ورود/ثبت‌نام فروشگاه).
 *
 * اصل امنیتی: هیچ شناسه‌ای از کلاینت گرفته نمی‌شود؛ همه چیز از نشستِ خوانده‌شده
 * روی همین درخواست می‌آید (`identity.userId` → رکورد `Customer` با `userId`).
 * پس حتی اگر کسی شناسهٔ دیگری بفرستد، به دادهٔ خودش دسترسی دارد نه دیگری.
 *
 * پوشش: پروفایل · سفارش‌ها · دفتر آدرس · چسباندن سبد مهمان به حساب بعد از ورود.
 */
@RequireCsrf()
@Controller("account")
export class AccountController {
  constructor(private readonly prisma: PrismaService) {}

  /** هویت مشتریِ واردشده — ۴۰۱ بدون نشست، ۴۰۳ برای نقش غیرمشتری */
  private async ctx(identity: AdminIdentity | null): Promise<{
    userId: string;
    customerId: string;
    mobile: string;
    name: string | null;
    email: string | null;
    createdAt: Date;
  }> {
    if (!identity?.userId) {
      throw new UnauthorizedException({ code: "AUTH_REQUIRED", message: "ابتدا وارد شوید." });
    }
    const user = await this.prisma.user.findUnique({ where: { id: identity.userId } });
    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedException({ code: "AUTH_REQUIRED", message: "ابتدا وارد شوید." });
    }
    if (user.role !== "CUSTOMER") {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "این بخش فقط برای حساب مشتری است." });
    }
    if (!user.mobile) {
      throw new BadRequestException({
        code: "ACCOUNT_INCOMPLETE",
        message: "حساب بدون شمارهٔ موبایل است؛ با پشتیبانی تماس بگیرید.",
      });
    }
    const customer = await this.prisma.customer.upsert({
      where: { userId: user.id },
      update: { mobile: user.mobile },
      create: { userId: user.id, mobile: user.mobile, ...(user.name ? { name: user.name } : {}) },
    });
    return {
      userId: user.id,
      customerId: customer.id,
      mobile: user.mobile,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
    };
  }

  // ------------------------------------------------------------ پروفایل

  @Get("me")
  async me(@Identity() identity: AdminIdentity | null) {
    const c = await this.ctx(identity);
    const orders = await this.prisma.order.count({ where: { userId: c.userId } });
    const addresses = await this.prisma.address.count({ where: { customerId: c.customerId } });
    return {
      name: c.name,
      email: c.email,
      mobile: c.mobile,
      createdAt: c.createdAt,
      ordersCount: orders,
      addressesCount: addresses,
    };
  }

  @Patch("me")
  async updateMe(
    @Identity() identity: AdminIdentity | null,
    @Body() body: { name?: unknown; email?: unknown },
  ) {
    const c = await this.ctx(identity);
    const name = String(body?.name ?? c.name ?? "").trim();
    const email = String(body?.email ?? c.email ?? "").trim().toLowerCase();
    if (name.length > 60) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        fieldErrors: { name: ["نام حداکثر ۶۰ حرف است."] },
      });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        fieldErrors: { email: ["ایمیل معتبر نیست."] },
      });
    }
    if (email) {
      const taken = await this.prisma.user.findFirst({
        where: { email, id: { not: c.userId } },
        select: { id: true },
      });
      if (taken) {
        throw new BadRequestException({
          code: "ACCOUNT_EXISTS",
          fieldErrors: { email: ["این ایمیل قبلاً استفاده شده است."] },
        });
      }
    }
    const user = await this.prisma.user.update({
      where: { id: c.userId },
      data: { name, ...(email ? { email } : {}) },
    });
    await this.prisma.customer.update({
      where: { id: c.customerId },
      data: { name, ...(email ? { email } : {}) },
    }).catch(() => undefined);
    return { name: user.name, email: user.email, mobile: user.mobile };
  }

  // ------------------------------------------------------------ سفارش‌ها

  @Get("orders")
  async orders(@Identity() identity: AdminIdentity | null) {
    const c = await this.ctx(identity);
    const rows = await this.prisma.order.findMany({
      where: { userId: c.userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        items: { select: { titleSnapshot: true, qty: true, lineTotal: true } },
      },
    });
    return {
      orders: rows.map((o) => ({
        code: o.code,
        status: o.status,
        paymentStatus: o.paymentStatus,
        total: o.total,
        createdAt: o.createdAt,
        itemsCount: o.items.reduce((n, i) => n + i.qty, 0),
        items: o.items.map((i) => ({ title: i.titleSnapshot, qty: i.qty, lineTotal: i.lineTotal })),
      })),
    };
  }

  // ------------------------------------------------------------ دفتر آدرس

  @Get("addresses")
  async addresses(@Identity() identity: AdminIdentity | null) {
    const c = await this.ctx(identity);
    const rows = await this.prisma.address.findMany({
      where: { customerId: c.customerId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
    // Address رابطهٔ Prisma با Province/City ندارد (FK خام) — نام‌ها جدا گرفته می‌شود
    const provIds = [...new Set(rows.map((a) => a.provinceId))];
    const cityIds = [...new Set(rows.map((a) => a.cityId))];
    const [provinces, cities] = await Promise.all([
      this.prisma.province.findMany({ where: { id: { in: provIds } }, select: { id: true, name: true } }),
      this.prisma.city.findMany({ where: { id: { in: cityIds } }, select: { id: true, name: true } }),
    ]);
    const provName = new Map(provinces.map((p) => [p.id, p.name]));
    const cityName = new Map(cities.map((ct) => [ct.id, ct.name]));
    return {
      addresses: rows.map((a) => ({
        id: a.id,
        provinceId: a.provinceId,
        cityId: a.cityId,
        province: provName.get(a.provinceId) ?? "",
        city: cityName.get(a.cityId) ?? "",
        line: a.line,
        postalCode: a.postalCode,
        plaque: a.plaque,
        unit: a.unit,
        isDefault: a.isDefault,
      })),
    };
  }

  @Post("addresses")
  async createAddress(
    @Identity() identity: AdminIdentity | null,
    @Body()
    body: {
      provinceId?: unknown;
      cityId?: unknown;
      line?: unknown;
      postalCode?: unknown;
      plaque?: unknown;
      unit?: unknown;
      isDefault?: unknown;
    },
  ) {
    const c = await this.ctx(identity);
    const provinceId = String(body?.provinceId ?? "");
    const cityId = String(body?.cityId ?? "");
    const line = String(body?.line ?? "").trim();
    const postalCode = String(body?.postalCode ?? "").replace(/\D/g, "");
    const fieldErrors: Record<string, string[]> = {};
    if (!provinceId) fieldErrors.provinceId = ["استان را انتخاب کنید."];
    if (!cityId) fieldErrors.cityId = ["شهر را انتخاب کنید."];
    if (line.length < 10) fieldErrors.line = ["نشانی باید حداقل ۱۰ نویسه باشد."];
    if (line.length > 300) fieldErrors.line = ["نشانی حداکثر ۳۰۰ نویسه است."];
    if (postalCode && !/^\d{10}$/.test(postalCode)) fieldErrors.postalCode = ["کد پستی ۱۰ رقمی است."];
    if (Object.keys(fieldErrors).length) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", fieldErrors });
    }
    // استان/شهر باید واقعی باشند (FK) — نام از کلاینت پذیرفته نمی‌شود
    const city = await this.prisma.city.findUnique({ where: { id: cityId } });
    const province = await this.prisma.province.findUnique({ where: { id: provinceId } });
    if (!province || !city || city.provinceId !== province.id) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        fieldErrors: { cityId: ["استان/شهر نامعتبر است؛ دوباره انتخاب کنید."] },
      });
    }
    const count = await this.prisma.address.count({ where: { customerId: c.customerId } });
    const isDefault = body?.isDefault === true || count === 0;
    if (isDefault) {
      await this.prisma.address.updateMany({
        where: { customerId: c.customerId, isDefault: true },
        data: { isDefault: false },
      });
    }
    const created = await this.prisma.address.create({
      data: {
        customerId: c.customerId,
        provinceId,
        cityId,
        line,
        ...(postalCode ? { postalCode } : {}),
        ...(String(body?.plaque ?? "").trim() ? { plaque: String(body.plaque).trim() } : {}),
        ...(String(body?.unit ?? "").trim() ? { unit: String(body.unit).trim() } : {}),
        isDefault,
      },
    });
    return { id: created.id, isDefault: created.isDefault };
  }

  @Delete("addresses/:id")
  @HttpCode(204)
  async deleteAddress(@Identity() identity: AdminIdentity | null, @Param("id") id: string) {
    const c = await this.ctx(identity);
    const r = await this.prisma.address.deleteMany({ where: { id, customerId: c.customerId } });
    if (r.count === 0) {
      throw new BadRequestException({ code: "NOT_FOUND", message: "آدرس پیدا نشد." });
    }
    return { ok: true };
  }

  @Patch("addresses/:id/default")
  async setDefaultAddress(
    @Identity() identity: AdminIdentity | null,
    @Param("id") id: string,
  ) {
    const c = await this.ctx(identity);
    // فقط اگر آدرس متعلق به همین مشتری باشد
    const address = await this.prisma.address.findFirst({
      where: { id, customerId: c.customerId },
    });
    if (!address) {
      throw new BadRequestException({ code: "NOT_FOUND", message: "آدرس پیدا نشد." });
    }
    await this.prisma.$transaction([
      this.prisma.address.updateMany({
        where: { customerId: c.customerId, isDefault: true },
        data: { isDefault: false },
      }),
      this.prisma.address.update({ where: { id }, data: { isDefault: true } }),
    ]);
    return { ok: true, id };
  }

  // ------------------------------------------------------------ سفارش‌ها: جزئیات

  @Get("orders/:code")
  async orderDetail(@Identity() identity: AdminIdentity | null, @Param("code") code: string) {
    const c = await this.ctx(identity);
    const order = await this.prisma.order.findFirst({
      where: { code, userId: c.userId },
      include: {
        items: {
          select: {
            id: true,
            titleSnapshot: true,
            variantTermsSnapshot: true,
            qty: true,
            unitPrice: true,
            lineTotal: true,
            variantId: true,
          },
        },
        payments: { take: 1, orderBy: { createdAt: "desc" } },
        shipments: { take: 1, orderBy: { createdAt: "desc" } },
      },
    });
    if (!order) {
      throw new BadRequestException({ code: "NOT_FOUND", message: "سفارش پیدا نشد." });
    }
    // @ts-ignore - Prisma client needs regeneration for relations
    const payment = order.payments?.[0] ?? null;
    // @ts-ignore - Prisma client needs regeneration for relations
    const shipment = order.shipments?.[0] ?? null;
    const addressSnap = order.addressSnapshot as
      | { line: string; postalCode: string; plaque?: string; unit?: string; provinceId: string; cityId: string }
      | null;
    return {
      code: order.code,
      status: order.status,
      paymentStatus: order.paymentStatus,
      total: order.total,
      subtotal: order.subtotal,
      shippingCost: order.shippingCost,
      discount: order.discountTotal,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      // @ts-ignore - Prisma client needs regeneration for relations
      items: order.items.map((i: any) => ({
        id: i.id,
        title: i.titleSnapshot,
        sku: i.variantTermsSnapshot ? JSON.stringify(i.variantTermsSnapshot) : "",
        qty: i.qty,
        unitPrice: i.unitPrice,
        lineTotal: i.lineTotal,
        variantId: i.variantId,
        productId: i.variantId,
      })),
      address: addressSnap
        ? {
            line: addressSnap.line,
            postalCode: addressSnap.postalCode,
            plaque: addressSnap.plaque ?? null,
            unit: addressSnap.unit ?? null,
            province: addressSnap.provinceId,
            city: addressSnap.cityId,
          }
        : null,
      payment: payment
        ? {
            provider: payment.gatewayId,
            refId: payment.refId,
            amount: payment.amount,
            status: payment.status,
            paidAt: payment.createdAt,
          }
        : null,
      shipment: shipment
        ? {
            carrier: shipment.provider,
            trackingCode: shipment.trackingCode,
            status: shipment.status,
            sentAt: shipment.shippedAt,
            deliveredAt: shipment.deliveredAt,
          }
        : null,
    };
  }

  // ------------------------------------------------------------ اتصال سبد

  /**
   * چسباندن سبد مهمان به حساب بعد از ورود/ثبت‌نام — کوکی `cart_token` مشتری
   * (توکنِ سبد مهمانش) فرستاده می‌شود و سبد به رکورد Customer می‌چسبد تا در
   * همهٔ دستگاه‌ها ادامه پیدا کند. اگر سبد از قبل متعلق به مشتری دیگری باشد،
   * دست نمی‌خورد (۴۰۹) — دادهٔ کسی ادغام/حذف نمی‌شود.
   */
  @Post("cart/attach")
  async attachCart(@Identity() identity: AdminIdentity | null, @Body() body: { token?: unknown }) {
    const c = await this.ctx(identity);
    const token = String(body?.token ?? "").trim();
    if (!token) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "توکن سبد ارسال نشده." });
    }
    const cart = await this.prisma.cart.findUnique({ where: { token } });
    if (!cart) return { ok: true, moved: 0, reason: "EMPTY_CART" };
    if (cart.customerId && cart.customerId !== c.customerId) {
      return { ok: false, code: "CART_OWNED", message: "این سبد متعلق به حساب دیگری است." };
    }
    if (cart.customerId === c.customerId) return { ok: true, moved: 0, reason: "ALREADY" };
    await this.prisma.cart.update({ where: { id: cart.id }, data: { customerId: c.customerId } });
    const count = await this.prisma.cartItem.count({ where: { cartId: cart.id } });
    return { ok: true, moved: count };
  }
}

