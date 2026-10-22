import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ConsentService } from "./consent.service";
import { MeasurementService } from "./measurement.service";
import { VisitsService } from "./visits.service";
import { AnalyticsPublicController } from "./analytics-public.controller";
import { AnalyticsAdminController } from "./analytics-admin.controller";

/**
 * گام ۱۵ — آنالیتیکس: رضایت بازدید ناشناس + رویداد purchase سمت سرور +
 * شمارش بازدید روزانهٔ first-party (گام ۱۵-۶).
 * کنترلر عمومی است (فروشگاه بدون لاگین می‌زند)؛ Measurement فقط از
 * سرویس‌های داخلی (finalizePaid) صدا زده می‌شود.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AnalyticsPublicController, AnalyticsAdminController],
  providers: [ConsentService, MeasurementService, VisitsService],
  exports: [MeasurementService],
})
export class AnalyticsModule {}
