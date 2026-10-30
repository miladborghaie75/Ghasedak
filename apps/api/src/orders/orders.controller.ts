import { Body, Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { OrdersService, type CheckoutInput } from "./orders.service";
import { RequirePermission } from "../auth/permissions.guard";
import { RequireCsrf } from "../auth/csrf.guard";
import { Identity } from "../auth/identity.decorator";
import { randomUUID } from "crypto";

/** اکشن‌های مینتِ مالی (ثبت سفارش/وضعیت) گارد CSRF دارند — گام ۲۲ */
@RequireCsrf()
@Controller("orders")
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post("checkout")
  async checkout(@Body() body: CheckoutInput, @Identity() identity?: { userId: string } | null) {
    const idem = body.idempotencyKey ?? randomUUID();
    // اگر مشتری واردشده باشد، سفارش به حسابش گره می‌خورد (وگرنه رفتار مهمانِ قبلی)
    const link = await this.orders.customerLink(identity?.userId ?? null, String(body.guestMobile ?? ""));
    const r = await this.orders.createGuestOrder(body, link);
    return { ...r, idempotencyKey: idem };
  }

  /**
   * بررسی کد تخفیف — عمومی، تا سبد مبلغ واقعی را نشان دهد.
   * تخفیف همیشه از همان منطق `createGuestOrder` محاسبه می‌شود؛
   * هیچ عددی سمت کلاینت ساخته نمی‌شود.
   */
  @Get("quote/coupon")
  async quoteCoupon(@Query() q: { code?: string; subtotal?: string; mobile?: string }) {
    const subtotal = Number(q.subtotal ?? 0);
    if (!q.code || !Number.isFinite(subtotal) || subtotal < 0) {
      return { valid: false as const };
    }
    try {
      // موبایل اختیاری — اگر بود، سهمیهٔ perCustomerLimit هم در پیش‌نمایش رعایت می‌شود
      return { valid: true as const, ...(await this.orders.quoteCoupon(q.code, subtotal, q.mobile || null)) };
    } catch {
      return { valid: false as const };
    }
  }

  @Post(":id/cancel")
  @RequirePermission("orders.update")
  async cancel(@Param("id") id: string, @Identity() actor?: { userId: string }) {
    await this.orders.cancelUnpaid(id, actor?.userId);
    return { ok: true };
  }

  /** ویرایش حرفه‌ای سفارش پرداخت‌نشده — بند ۶ فاز ۱۴: محاسبه دوباره + تاریخچه بازبینی */
  @Post(":id/edit")
  @RequirePermission("orders.update")
  async edit(
    @Param("id") id: string,
    @Body() body: {
      lines?: Array<{ sku: string; qty: number }>;
      guestName?: string; guestMobile?: string;
      address?: {
        province: string; city: string; address: string; plaque: string; unit?: string; postalCode: string;
      };
      shippingMethodId?: string; reason?: string;
    },
    @Identity() actor?: { userId: string },
  ) {
    return this.orders.editOrder({ orderId: id, actorId: actor?.userId, ...body });
  }

  /** تاریخچهٔ بازبینی سفارش */
  @Get(":id/revisions")
  @RequirePermission("orders.view")
  async revisions(@Param("id") id: string) {
    return this.orders.orderRevisions(id);
  }

  @Get()
  @RequirePermission("orders.view")
  list(@Query() q: { page?: string; limit?: string; status?: string }) {
    return this.orders.list({
      page: q.page ? Number(q.page) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
      status: q.status,
    });
  }

  /**
   * سفارش با کد — دو نسخه:
   *  - هویت ادمین با `orders.view` → کامل (فاکتور/لیست ادمین)
   *  - عمومی (مهمانِ پرداخت) → بدون PII (اسم/موبایل/آدرس) — کد سریالی حدس‌پذیر است (ایمنی IDOR)
   */
  @Get("by-code/:code")
  async byCode(
    @Param("code") code: string,
    @Identity() identity?: { permissions: string[] } | null,
  ) {
    const perms = identity?.permissions ?? [];
    const full = perms.includes("*") || perms.includes("orders.view");
    const order = full ? await this.orders.byCode(code) : await this.orders.byCodePublic(code);
    // پیش از این مسیر برای کد ناموجود ۲۰۰ با بدنهٔ null برمی‌گرداند؛ ۲۰۰ بدون بدنه
    // "یافت نشد" و "یافت شد" را برای کلاینت/خزنده یکی می‌کرد. الان ۴۰۴ صریح است.
    if (!order) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "سفارش یافت نشد." });
    }
    return order;
  }
}
