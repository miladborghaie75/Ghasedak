import { Body, Controller, Post } from "@nestjs/common";
import { CogsBackfillService } from "./cogs-backfill.service";
import { RequirePermission } from "../auth/permissions.guard";
import { Identity } from "../auth/identity.decorator";
import type { AdminIdentity } from "../auth/auth.service";

/**
 * اکشن ادمین «ثبت COGS عقب‌افتاده» (F0-2) — در تب سود گزارش‌های مدیریتی.
 *
 * - با `orderId` فقط همان سفارش؛ بدون آن اسکن دسته‌ای سفارش‌های PAID اخیر.
 * - هر سند ثبت‌شده AuditLog با action=`accounting.cogs.backfill` می‌گیرد.
 */
@Controller("admin/accounting/cogs")
export class CogsBackfillController {
  constructor(private readonly cogs: CogsBackfillService) {}

  @Post("backfill")
  @RequirePermission("accounting.reports")
  async backfill(
    @Body() body: { orderId?: string; limit?: number },
    @Identity() me: AdminIdentity | null,
  ) {
    if (body?.orderId) {
      return this.cogs.backfillOrder(String(body.orderId), me?.userId);
    }
    return this.cogs.scan(me?.userId, Number(body?.limit) || 50);
  }
}
