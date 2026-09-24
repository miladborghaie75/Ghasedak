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
