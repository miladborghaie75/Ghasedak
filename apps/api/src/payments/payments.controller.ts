import { BadRequestException, Body, Controller, Get, Headers, Logger, NotFoundException, Param, Post, Query, UnauthorizedException } from "@nestjs/common";
import { PaymentsService } from "./payments.service";
import { PrismaService } from "../prisma/prisma.service";
import { RequirePermission } from "../auth/permissions.guard";
import { RequireCsrf } from "../auth/csrf.guard";

interface StartBody {
  orderId: string;
  methodId?: string;
  idempotencyKey: string;
  callbackUrl?: string;
  guestMobile?: string;
}

/**
 * callback عمومی درگاه — هرگز تایید نیست؛ فقط ثبت و سپس verify سمت‌سرور (بند ۷).
 * مسیرهای درگاه سمت‌سرور فراخوانی می‌شوند (بدون Origin) و از گارد CSRF عبور می‌کنند؛
 * اکشن‌های مینتِ مالیِ مرورگری بدون توکن/با Origin غریب ۴۰۳ می‌گیرند (گام ۲۲).
 */
@RequireCsrf()
@Controller("payments")
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly prisma: PrismaService,
  ) {}

  private readonly logger = new Logger(PaymentsController.name);

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

  /** verify سمت‌سرور با authority (بند ۷) — کد سفارش برای بازگشت کاربر به صفحهٔ درست */
  @Post("verify/:authority")
  async verifyByAuthority(@Param("authority") authority: string) {
    const attempt = await this.payments.byAuthority(authority);
    if (!attempt) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "پرداخت یافت نشد." });
    }
    const result = await this.payments.verify(attempt.id);
    const full = await this.prisma.paymentAttempt.findUnique({
      where: { id: attempt.id },
      select: { order: { select: { code: true } } },
    });
    return { ...result, orderCode: full?.order?.code ?? null };
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
    @Headers("x-webhook-secret") secret?: string,
  ): Promise<{ ok: boolean }> {
    // امضای وب‌هوک (فاز ۱ — گام ۴): اگر WEBHOOK_SECRET تنظیم شده باشد، اجبار می‌شود؛
    // در غیر این صورت فقط هشدار (warn-only) — چون زرین‌پال امضای HMAC ندارد و
    // مرجع امنِ واقعی همان verify سمت‌سرور است (بند ۷).
    const expected = process.env.WEBHOOK_SECRET ?? "";
    if (expected) {
      if (secret !== expected) {
        this.logger.warn(`webhook rejected: bad secret for provider=${provider}`);
        throw new UnauthorizedException({ code: "WEBHOOK_UNAUTHORIZED", message: "امضای وب‌هوک نامعتبر است." });
      }
    } else {
      const attemptAuthority = body.Authority ?? body.authority;
      this.logger.warn(
        `webhook ${provider} (authority=${attemptAuthority ?? "-"}) بدون امضا پردازش شد — WEBHOOK_SECRET تنظیم نشده است`,
      );
    }

    const authority = body.Authority ?? body.authority;
    if (authority) {
      await this.payments.registerCallback(authority, body.status ?? "NOK");
      const attempt = await this.payments.byAuthority(authority);
      if (attempt && attempt.state === "CALLBACK_RECEIVED") {
        try {
          await this.payments.verify(attempt.id);
        } catch (e) {
          // شکست verify صریح ثبت شده؛ پاسخ به درگاه ساده می‌ماند
          this.logger.warn(`callback verify failed for authority=${authority}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    void provider;
    return { ok: true };
  }
}

export type { StartBody };
