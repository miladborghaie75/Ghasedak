import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { OrdersService, type CheckoutInput } from "./orders.service";
import { RequirePermission } from "../auth/permissions.guard";
import { Identity } from "../auth/identity.decorator";
import { randomUUID } from "crypto";

@Controller("orders")
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post("checkout")
  async checkout(@Body() body: CheckoutInput) {
    const idem = body.idempotencyKey ?? randomUUID();
    const r = await this.orders.createGuestOrder(body);
    return { ...r, idempotencyKey: idem };
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

  @Get("by-code/:code")
  byCode(@Param("code") code: string) {
    return this.orders.byCode(code);
  }
}
