import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { RequirePermission } from "../auth/permissions.guard";
import { WebhooksService } from "./webhooks.service";

/**
 * وبهوک‌های خروجی — گام ۱۸. مدیریت مشترکین رویدادها از پنل ادمین:
 * ثبت endpoint با secret یک‌بارنمایش، تست پینگ، تاریخچهٔ تحویل و retry دستی.
 * مجوز: settings.manage (هم‌ردهٔ سایر تنظیمات امنیتی پنل).
 */
@Controller("admin/webhooks")
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  @RequirePermission("settings.manage")
  list() {
    return this.webhooks.listEndpoints();
  }

  @Post()
  @RequirePermission("settings.manage")
  create(@Body() body: { url?: string; events?: string[]; description?: string }) {
    return this.webhooks.createEndpoint({
      url: String(body.url ?? ""),
      events: Array.isArray(body.events) ? body.events.map(String) : [],
      description: body.description,
    });
  }

  @Patch(":id")
  @RequirePermission("settings.manage")
  update(
    @Param("id") id: string,
    @Body() body: { url?: string; events?: string[]; description?: string | null; active?: boolean },
  ) {
    return this.webhooks.updateEndpoint(id, {
      url: body.url,
      events: body.events === undefined ? undefined : body.events.map(String),
      description: body.description,
      active: body.active,
    });
  }

  @Delete(":id")
  @RequirePermission("settings.manage")
  remove(@Param("id") id: string) {
    return this.webhooks.deleteEndpoint(id);
  }

  @Post(":id/rotate-secret")
  @RequirePermission("settings.manage")
  rotateSecret(@Param("id") id: string) {
    return this.webhooks.rotateSecret(id);
  }

  @Post(":id/test")
  @RequirePermission("settings.manage")
  test(@Param("id") id: string) {
    return this.webhooks.testPing(id);
  }

  @Get(":id/deliveries")
  @RequirePermission("settings.manage")
  deliveries(@Param("id") id: string, @Query() q: { page?: string }) {
    return this.webhooks.listDeliveries(id, q);
  }

  @Post("deliveries/:id/retry")
  @RequirePermission("settings.manage")
  retry(@Param("id") id: string) {
    return this.webhooks.retryDelivery(id);
  }
}
