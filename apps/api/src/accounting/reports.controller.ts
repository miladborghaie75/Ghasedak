import { Controller, Get, Query } from "@nestjs/common";
import { ReportsService } from "./reports.service";
import { RequirePermission } from "../auth/permissions.guard";

/**
 * گزارش‌های فاز ۵.
 *
 * گزارش‌های سادهٔ مالی (تراز آزمایشی، ترازنامه، سود و زیان، جریان نقدینگی)
 * از قبل در `accounting-reports.controller.ts` بودند. اینجا آن‌هایی است که
 * **غایب** بودند و برای تصمیم مدیریتی لازم‌اند:
 * بدهکاران با سن سررسید، سودآوری کالا و دسته، مغایرت بانکی، چک‌های سررسید.
 */
@Controller("admin/accounting/reports")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** حساب‌های دریافتنی/پرداختنی + سنی بدهکاران */
  @Get("ar-ap")
  @RequirePermission("accounting.reports")
  arAp(@Query("asOf") asOf?: string) {
    return this.reports.receivablesPayables(asOf);
  }

  /** سود هر کالا و هر دسته */
  @Get("product-profitability")
  @RequirePermission("accounting.reports")
  productProfitability(@Query() q: { from?: string; to?: string }) {
    return this.reports.productProfitability(q.from, q.to);
  }

  /** مغایرت بانکی همهٔ حساب‌های بانکی */
  @Get("bank-reconciliation")
  @RequirePermission("accounting.reports")
  bankReconciliation() {
    return this.reports.bankReconciliation();
  }

  /** ارزش‌گذاری و مقایسهٔ دفتر با انبار برای هر انبار (فاز ۶) */
  @Get("warehouse-valuation")
  @RequirePermission("accounting.reports")
  warehouseValuation(@Query() q: { from?: string; to?: string }) {
    return this.reports.warehouseValuation(q.from, q.to);
  }

  /** چک‌های سررسید گذشته و نزدیک — برای داشبورد مدیریتی */
  @Get("checks-due")
  @RequirePermission("accounting.reports")
  checksDue(@Query("withinDays") withinDays?: string) {
    const n = Number(withinDays ?? 30);
    return this.reports.checksDue(Number.isFinite(n) && n > 0 ? Math.min(365, n) : 30);
  }
}
