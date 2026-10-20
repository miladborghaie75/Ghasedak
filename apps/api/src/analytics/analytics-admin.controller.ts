import { Controller, Get, Query } from "@nestjs/common";
import { RequirePermission } from "../auth/permissions.guard";
import { VisitsService } from "./visits.service";

/**
 * آمار بازدید برای داشبورد ادمین (گام ۱۵-۶).
 *
 * مجوز همان dashboard.view است چون این بخشِ همان صفحهٔ داشبورد است؛
 * مجوز جداگانه (analytics.view) بعداً اگر نقش «بازاریاب» اضافه شد.
 *
 * ساده‌ترین شکل ممکن: ورودی from/to، خروجی نقاط روزانه + تجمیع‌های
 * تقویمی. هیچ raw-query یا عدد ساختگی وجود ندارد — روز بی‌بازدید = صفرِ واقعی.
 */
@Controller("admin/analytics")
export class AnalyticsAdminController {
  constructor(private readonly visits: VisitsService) {}

  @Get("visits")
  @RequirePermission("dashboard.view")
  async visitsSummary(
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const today = new Date();
    const start = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);
    return this.visits.summary(
      from ?? start.toISOString().slice(0, 10),
      to ?? today.toISOString().slice(0, 10),
    );
  }
}
