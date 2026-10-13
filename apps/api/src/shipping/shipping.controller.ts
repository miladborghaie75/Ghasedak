import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ShippingService } from "./shipping.service";
import { RequirePermission } from "../auth/permissions.guard";
import { Identity } from "../auth/identity.decorator";

@Controller("shipping")
export class ShippingController {
  constructor(private readonly shipping: ShippingService) {}

  /** مرسوله‌های یک سفارش — پنل ارسال ادمین */
  @Get("shipments")
  @RequirePermission("orders.view")
  list(@Query("orderId") orderId: string) {
    return this.shipping.listForOrder(orderId);
  }

  @Post("shipments")
  @RequirePermission("orders.update")
  create(@Body() body: { orderId: string; provider?: string; trackingCode?: string }) {
    return this.shipping.create(body);
  }

  /** تحویل به پست — کد رهگیری ثبت و سفارش به «بسته‌بندی شده» می‌رود */
  @Post("shipments/:id/label")
  @RequirePermission("orders.update")
  label(@Param("id") id: string, @Body() body: { provider: string; trackingCode: string }) {
    return this.shipping.label(id, body);
  }

  @Post("shipments/:id/status")
  @RequirePermission("orders.update")
  mark(
    @Param("id") id: string,
    @Body() body: { status: "IN_TRANSIT" | "DELIVERED" | "RETURNED_TO_SENDER" | "FAILED" },
    @Identity() actor?: { userId: string },
  ) {
    return this.shipping.mark(id, body.status, actor?.userId);
  }

  /**
   * رهگیری عمومی — کد پستی یا کد سفارش را می‌پذیرد.
   * مسیر `/shipping/track/:code` عمداً عمومی است: مشتریِ مهمان باید بتواند
   * مرسوله‌اش را دنبال کند، پس نیازی به ورود به حساب نیست.
   */
  @Get("track/:code")
  track(@Param("code") code: string) {
    return this.shipping.track(code);
  }
}
