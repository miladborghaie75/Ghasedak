import { Module, forwardRef } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AccountingController } from "./accounting.controller";
import { AccountingReportsController } from "./accounting-reports.controller";
import { JournalService } from "./journal.service";
import { CashFlowService } from "./cash-flow.service";
import { ReportsService } from "./reports.service";
import { ReportsController } from "./reports.controller";
import { DashboardService } from "./dashboard.service";
import { DashboardController } from "./dashboard.controller";
import { FiscalYearService } from "./fiscal-year.service";
import { FiscalYearController } from "./fiscal-year.controller";
import { ProductsModule } from "../products/products.module";

@Module({
  // `forwardRef` چون وابستگی حلقوی با ProductsModule داریم
  // (محصولات برای سند موجودی آغازین، حسابداری برای گزارش‌ها)
  imports: [PrismaModule, forwardRef(() => ProductsModule)],
  controllers: [
    AccountingController,
    AccountingReportsController,
    FiscalYearController,
    ReportsController,
    DashboardController,
  ],
  providers: [JournalService, CashFlowService, FiscalYearService, ReportsService, DashboardService],
  // FiscalYearService هم export می‌شود چون فازهای بعد (سند اختتامیه، کنترل
  // دسترسی سال مالی در مسیرهای فروش/خرید) به آن نیاز دارند.
  exports: [JournalService, FiscalYearService, ReportsService, CashFlowService],
})
export class AccountingModule {}