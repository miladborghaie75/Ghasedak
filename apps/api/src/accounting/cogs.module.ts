import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AccountingModule } from "./accounting.module";
import { InventoryModule } from "../inventory/inventory.module";
import { CogsBackfillService } from "./cogs-backfill.service";
import { CogsBackfillController } from "./cogs-backfill.controller";

/**
 * ماژول مستقل بازپرکردن COGS (F0-2).
 *
 * چرا ماژول جدا و نه داخل AccountingModule؟ چون این سرویس هم به
 * InventoryService (WAC) و هم به JournalService نیاز دارد؛
 * AccountingModule ← InventoryModule یک‌طرفه است و افزودن وابستگی
 * معکوس، حلقهٔ جدید می‌ساخت. اینجا هر دو فقط import می‌شوند.
 */
@Module({
  imports: [PrismaModule, AccountingModule, InventoryModule],
  controllers: [CogsBackfillController],
  providers: [CogsBackfillService],
  exports: [CogsBackfillService],
})
export class CogsModule {}
