import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { ReturnsService } from "./returns.service";
import { RequirePermission } from "../auth/permissions.guard";
import { Identity } from "../auth/identity.decorator";
import { PrismaService } from "../prisma/prisma.service";

@Controller("returns")
export class ReturnsController {
  constructor(
    private readonly returns: ReturnsService,
    private readonly prisma: PrismaService,
  ) {}

  /** ثبت درخواست مرجوعی — عمومی با شماره سفارش (مشتری) یا از ادمین */
  @Post()
  async request(@Body() body: { orderCode?: string; orderId?: string; items: Array<{ orderItemId: string; qty: number; condition?: string; reason?: string }>; reason?: string; notes?: string }) {
    const order = body.orderCode
      ? await this.prisma.order.findUnique({ where: { code: body.orderCode }, select: { id: true } })
      : body.orderId
        ? await this.prisma.order.findUnique({ where: { id: body.orderId }, select: { id: true } })
        : null;
    if (!order) throw new NotFoundException({ code: "NOT_FOUND", message: "سفارش یافت نشد." });
    return this.returns.request({ orderId: order.id, items: body.items, reason: body.reason, notes: body.notes });
  }

  @Get()
  @RequirePermission("orders.view")
  list(@Query() q: { status?: string }) {
    return this.prisma.returnRequest.findMany({
      where: q.status ? { status: q.status as never } : {},
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { items: true },
    });
  }

  @Post(":id/approve")
  @RequirePermission("returns.manage")
  approve(@Param("id") id: string, @Identity() actor?: { userId: string }) {
    return this.returns.approve(id, actor?.userId);
  }

  @Post(":id/reject")
  @RequirePermission("returns.manage")
  reject(@Param("id") id: string, @Identity() actor?: { userId: string }) {
    return this.returns.reject(id, actor?.userId);
  }

  @Post(":id/receive")
  @RequirePermission("returns.manage")
  receive(@Param("id") id: string, @Identity() actor?: { userId: string }) {
    return this.returns.receive(id, actor?.userId);
  }

  @Post(":id/settle")
  @RequirePermission("orders.refund")
  settle(@Param("id") id: string, @Identity() actor?: { userId: string }) {
    return this.returns.settle(id, actor?.userId);
  }
}
