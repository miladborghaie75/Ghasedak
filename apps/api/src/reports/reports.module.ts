import { Module } from "@nestjs/common";
import { ProfitController } from "./profit.controller";

/** ماژول گزارش‌ها — سود واقعی از منابع حقیقت (GL + دفتر انبار) */
@Module({
  controllers: [ProfitController],
})
export class ReportsModule {}
