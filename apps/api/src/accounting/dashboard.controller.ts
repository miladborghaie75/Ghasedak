import { Controller, Get, Query } from "@nestjs/common";
import { DashboardService } from "./dashboard.service";
import { RequirePermission } from "../auth/permissions.guard";

/**
 * دادهٔ نمودارها و جدول‌های داشبورد مدیریتی (فاز ۷).
 *
 * همه از دفتر کل می‌خوانند و بازهٔ زمانی‌شان از سمت کلاینت می‌آید، چون
 * گزارش مالی بدون بازهٔ مشخص معنی ندارد.
 */
@Controller("admin/accounting/dashboard")
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  @Get("overview")
  @RequirePermission("accounting.view")
  overview() {
    return this.svc.overview();
  }

  @Get("trend")
  @RequirePermission("accounting.view")
  trend(@Query() q: { from?: string; to?: string; granularity?: "day" | "month" | "auto" }) {
    return this.svc.trend(q.from, q.to, q.granularity ?? "auto");
  }

  @Get("channels")
  @RequirePermission("accounting.view")
  channels(@Query() q: { from?: string; to?: string }) {
    return this.svc.byChannel(q.from, q.to);
  }

  @Get("expenses")
  @RequirePermission("accounting.view")
  expenses(@Query() q: { from?: string; to?: string }) {
    return this.svc.expenseStructure(q.from, q.to);
  }

  @Get("cash-flow")
  @RequirePermission("accounting.view")
  cashFlow(@Query() q: { from?: string; to?: string }) {
    return this.svc.cashFlowTrend(q.from, q.to);
  }
}