import { Body, Controller, Get, Post } from "@nestjs/common";
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
}
