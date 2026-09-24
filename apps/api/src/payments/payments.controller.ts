import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { PaymentsService } from "./payments.service";
import { PrismaService } from "../prisma/prisma.service";
import { RequirePermission } from "../auth/permissions.guard";

interface StartBody {
  orderId: string;
  methodId?: string;
  idempotencyKey: string;
  callbackUrl?: string;
  guestMobile?: string;
}

/** callback عمومی درگاه — هرگز تایید نیست؛ فقط ثبت و سپس verify سمت‌سرور (بند ۷) */
@Controller("payments")
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly prisma: PrismaService,
  ) {}

  /** روش‌های فعال — فیلدهای عمومی فقط (بند ۴) */
  @Get("methods")
  async methods() {
    const rows = await this.prisma.paymentMethod.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        code: true,
        namePublic: true,
        description: true,
        customerInstructions: true,
        sortOrder: true,
      },
    });
    return rows;
  }

  /** شروع پرداخت آنلاین (بند ۶) */
  @Post("start")
  async start(@Body() body: StartBody) {
    let methodId = body.methodId;
    if (!methodId) {
      const m = await this.prisma.paymentMethod.findFirst({ where: { code: "online", active: true } });
      if (!m) {
        throw new BadRequestException({ code: "NO_ONLINE_METHOD", message: "پرداخت آنلاین فعال نیست." });
      }
      methodId = m.id;
    }
    const r = await this.payments.startOnlinePayment({
      orderId: body.orderId,
      methodId,
      idempotencyKey: body.idempotencyKey,
      callbackUrl: body.callbackUrl ?? "",
      guestMobile: body.guestMobile,
    });
    return r;
  }

  /** verify سمت‌سرور با authority (بند ۷) */
  @Post("verify/:authority")
  async verifyByAuthority(@Param("authority") authority: string) {
    const attempt = await this.payments.byAuthority(authority);
    if (!attempt) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "پرداخت یافت نشد." });
    }
    return this.payments.verify(attempt.id);
  }

  /** لیست ادمین — بند ۲۷ (فیلتر status/method) */
  @Get("admin/list")
  @RequirePermission("payments.view")
  async adminList(@Query() q: { status?: string; page?: string }) {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = 20;
    const where = q.status ? { state: q.status as never } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.paymentAttempt.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          method: { select: { namePublic: true } },
          order: { select: { code: true } },
        },
      }),
      this.prisma.paymentAttempt.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  @Post("callback/:provider")
  async callback(
    @Param("provider") provider: string,
    @Body() body: { Authority?: string; authority?: string; status?: string },
  ): Promise<{ ok: boolean }> {
    const authority = body.Authority ?? body.authority;
    if (authority) {
      await this.payments.registerCallback(authority, body.status ?? "NOK");
      const attempt = await this.payments.byAuthority(authority);
      if (attempt && attempt.state === "CALLBACK_RECEIVED") {
        try {
          await this.payments.verify(attempt.id);
        } catch {
          // شکست verify صریح ثبت شده؛ پاسخ به درگاه ساده می‌ماند
        }
      }
    }
    void provider;
    return { ok: true };
  }
}

export type { StartBody };
