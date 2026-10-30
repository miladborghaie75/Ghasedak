import { Module } from "@nestjs/common";
import { HealthModule } from "../health/health.module";
import { AlertingService } from "./alerting.service";
import { HealthWatchService } from "./health-watch.service";

/**
 * ماژول مانیتورینگ (گام ۲۳ — بستهٔ C):
 *  - `AlertingService` — ارسال هشدار (تلگرام → بله → ایمیل → dry-run)؛ به رأس هشدار پیوست می‌شود.
 *  - `HealthWatchService` — تایمر سلامت/دیسک/بکاپ که رویداد هشدار شلیک می‌کند.
 *
 * ارتباط با بقیهٔ سیستم از رأس سطح-ماژول (`alert-bus.ts`) می‌رود تا filter خطاها،
 * workerهای تایمردار و سرویس پرداخت بدون وابستگی دور به ماژول، هشدار شلیک کنند.
 */
@Module({
  imports: [HealthModule],
  providers: [AlertingService, HealthWatchService],
  exports: [AlertingService],
})
export class MonitoringModule {}
