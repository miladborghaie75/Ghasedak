import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { SettlementService } from "./settlement.service";
import { RequirePermission } from "../auth/permissions.guard";
import { Identity } from "../auth/identity.decorator";

/**
 * تسویهٔ درگاه — فاز ۲٫۵
 *
 * جریان کار برای مدیر:
 *   ۱) گزارش تسویهٔ درگاه را وارد می‌کند (یا بعداً خودکار از درگاه خوانده می‌شود)
 *   ۲) بسته `PENDING` ساخته می‌شود و پرداخت‌های مربوطه به آن وصل می‌شوند
 *   ۳) با «ثبت سند»، پول از «طلب از درگاه» به بانک منتقل می‌شود
 *
 * تا قبل از گام ۳ هیچ تغییری در حساب بانک نمی‌افتد — یعنی یک ورودی اشتباه
 * قابل بی‌خطر بودن است.
 */
@Controller("admin/settlements")
export class SettlementController {
  constructor(private readonly svc: SettlementService) {}

  @Get()
  @RequirePermission("payments.view")
  list(@Query("providerId") providerId?: string) {
    return this.svc.list(providerId);
  }

  @Get("summary")
  @RequirePermission("payments.view")
  summary() {
    return this.svc.summary();
  }

  /** پرداخت‌های تأییدشده‌ای که هنوز در هیچ بستهٔ تسویه‌ای نیامده‌اند */
  @Get("unsettled")
  @RequirePermission("payments.view")
  unsettled(@Query("providerId") providerId?: string) {
    return this.svc.unsettled(providerId);
  }

  @Post()
  @RequirePermission("payments.manage")
  create(
    @Body()
    body: {
      providerId: string;
      reference: string;
      settlementDate: string;
      grossAmount: number;
      feeAmount?: number;
      note?: string;
      attemptIds?: string[];
    },
  ) {
    return this.svc.createBatch(body);
  }

  /** ثبت سند حسابداری تسویه — پول به حساب بانک منتقل می‌شود */
  @Post(":id/post")
  @RequirePermission("payments.manage")
  post(@Param("id") id: string, @Identity() actor?: { userId: string }) {
    return this.svc.postBatch(id, actor?.userId);
  }

  @Post(":id/void")
  @RequirePermission("payments.manage")
  voidBatch(@Param("id") id: string, @Body() body: { reason?: string }) {
    return this.svc.voidBatch(id, body.reason);
  }
}
