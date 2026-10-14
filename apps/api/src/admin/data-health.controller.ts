import { Body, Controller, Get, Post } from "@nestjs/common";
import { DataHealthService } from "./data-health.service";
import { RequirePermission } from "../auth/permissions.guard";
import { Identity } from "../auth/identity.decorator";
import type { AdminIdentity } from "../auth/auth.service";

/**
 * گام F0-3 — اکشن ادمین «کیفیت داده» در تنظیمات → عیب‌یابی.
 *
 * - `GET /admin/data-health` → اسکن فقط-خواندنی (settings.view)
 * - `POST /admin/data-health/repair` → اصلاح idempotent (settings.manage)
 *   هر ردیف اصلاح‌شده AuditLog با action=`data.health.repair` و قبل/بعد دارد.
 */
@Controller("admin/data-health")
export class DataHealthController {
  constructor(private readonly dataHealth: DataHealthService) {}

  @Get()
  @RequirePermission("settings.view")
  scan() {
    return this.dataHealth.scan();
  }

  @Post("repair")
  @RequirePermission("settings.manage")
  repair(@Body() body: { ids?: string[] }, @Identity() me: AdminIdentity | null) {
    const ids = Array.isArray(body?.ids) && body.ids.length ? body.ids.map(String) : undefined;
    return this.dataHealth.repair(me?.userId, ids);
  }
}
