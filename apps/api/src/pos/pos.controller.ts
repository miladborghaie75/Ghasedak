import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { PosService, type PosSaleInput } from "./pos.service";
import { RequirePermission } from "../auth/permissions.guard";
import { Identity } from "../auth/identity.decorator";
import { PrismaService } from "../prisma/prisma.service";

@Controller("pos")
export class PosController {
  constructor(
    private readonly pos: PosService,
    private readonly prisma: PrismaService,
  ) {}

  @Post("shift/open")
  @RequirePermission("pos.sell")
  openShift(
    @Body() body: { registerName?: string; openingCash?: number },
    @Identity() actor?: { userId: string },
  ) {
    return this.pos.openShift({
      userId: actor?.userId ?? "",
      registerName: body.registerName ?? "MAIN",
      openingCash: Number(body.openingCash ?? 0),
    });
  }

  @Post("shift/close")
  @RequirePermission("pos.sell")
  closeShift(
    @Body() body: { shiftId: string; actualCash: number },
    @Identity() actor?: { userId: string },
  ) {
    return this.pos.closeShift({
      shiftId: body.shiftId,
      userId: actor?.userId ?? "",
      actualCash: Number(body.actualCash ?? 0),
    });
  }

  @Post("sale")
  @RequirePermission("pos.sell")
  sale(@Body() body: PosSaleInput, @Identity() actor?: { userId: string }) {
    return this.pos.sale(body, actor?.userId ?? "");
  }

  @Get("shift/current")
  @RequirePermission("pos.view")
  currentShift(@Identity() actor?: { userId: string }) {
    return this.prisma.cashierShift.findFirst({
      where: { userId: actor?.userId ?? "", state: "OPEN" },
      include: { register: true },
    });
  }

  @Get("invoices")
  @RequirePermission("pos.view")
  invoices() {
    return this.prisma.posInvoice.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { number: true, grandTotal: true, state: true, customerMobile: true, createdAt: true },
    });
  }

  /** فاز ۱۰ — لیست عملیاتی با فیلترها (بخش ۷) */
  @Get("invoices/search")
  @RequirePermission("pos.view")
  invoiceList(
    @Query() q: { q?: string; cashierId?: string; method?: string; state?: string; from?: string; to?: string; take?: string },
  ) {
    return this.pos.invoiceList({
      q: q.q,
      cashierId: q.cashierId,
      method: q.method,
      state: q.state,
      from: q.from,
      to: q.to,
      take: q.take ? Number(q.take) : undefined,
    });
  }

  /** فاز ۱۰ — جزئیات فاکتور از دادهٔ persisted (بخش ۵) — مسیر by-number برای چاپ/مشاهده */
  @Get("invoices/by-number/:number")
  @RequirePermission("pos.view")
  invoiceDetailByNumber(@Param("number") number: string) {
    return this.prisma.posInvoice.findUnique({
      where: { number },
      include: {
        items: { include: { variant: { select: { sku: true, product: { select: { name: true } } } } } },
        payments: true,
        cashier: { select: { id: true, name: true } },
        shift: { select: { id: true, openedAt: true, register: { select: { name: true } } } },
      },
    });
  }

  /** جزئیات با id — قبل از مسیرهای :id دیگر */
  @Get("invoices/by-id/:id")
  @RequirePermission("pos.view")
  invoiceDetail(@Param("id") id: string) {
    return this.pos.invoiceDetail(id);
  }

  /** فاز ۱۰ — اصلاحیهٔ کنترل‌شده (بخش ۶) — بجای overwrite */
  @Post("invoices/by-id/:id/correct")
  @RequirePermission("pos.sell")
  correctInvoice(
    @Param("id") id: string,
    @Body() body: {
      lines: Array<{ sku: string; qty: number }>;
      payments: PosSaleInput["payments"];
      discountTotal?: number;
      reason: string;
      idempotencyKey?: string;
      shiftId: string;
    },
    @Identity() actor?: { userId: string },
  ) {
    return this.pos.correctInvoice({ ...body, invoiceId: id }, actor?.userId ?? "");
  }

  // ---------------- فاز ۱۱ (P2-A) — تیکت ماندگار ----------------

  @Post("tickets")
  @RequirePermission("pos.sell")
  ticketCreate(
    @Body() body: { items?: Array<{ sku: string; qty: number }>; customerMobile?: string; customerName?: string; discountTotal?: number },
    @Identity() actor?: { userId: string },
  ) {
    return this.pos.ticketCreate({ userId: actor?.userId ?? "", items: body.items, customerMobile: body.customerMobile, customerName: body.customerName, discountTotal: body.discountTotal });
  }

  @Get("tickets")
  @RequirePermission("pos.view")
  ticketList(@Identity() actor?: { userId: string }) {
    return this.pos.ticketList(actor?.userId ?? "");
  }

  @Get("tickets/:id")
  @RequirePermission("pos.view")
  ticketGet(@Param("id") id: string) {
    return this.pos.ticketGet(id);
  }

  @Post("tickets/:id/update")
  @RequirePermission("pos.sell")
  ticketUpdate(
    @Param("id") id: string,
    @Body() body: { expectedVersion: number; items?: Array<{ sku: string; qty: number }>; customerMobile?: string; customerName?: string; discountTotal?: number },
    @Identity() actor?: { userId: string },
  ) {
    return this.pos.ticketUpdate(id, { expectedVersion: body.expectedVersion, actorId: actor?.userId ?? "", items: body.items, customerMobile: body.customerMobile, customerName: body.customerName, discountTotal: body.discountTotal });
  }

  @Post("tickets/:id/transition")
  @RequirePermission("pos.sell")
  ticketTransition(
    @Param("id") id: string,
    @Body() body: { expectedVersion: number; to: "HELD" | "OPEN" | "CANCELLED" },
    @Identity() actor?: { userId: string },
  ) {
    return this.pos.ticketTransition(id, { expectedVersion: body.expectedVersion, actorId: actor?.userId ?? "", to: body.to });
  }

  @Post("tickets/:id/complete")
  @RequirePermission("pos.sell")
  ticketComplete(
    @Param("id") id: string,
    @Body() body: { expectedVersion: number; invoiceId?: string },
    @Identity() actor?: { userId: string },
  ) {
    return this.pos.ticketComplete(id, { expectedVersion: body.expectedVersion, actorId: actor?.userId ?? "", invoiceId: body.invoiceId });
  }
}
