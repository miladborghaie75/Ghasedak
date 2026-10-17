import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { InventoryModule } from "../inventory/inventory.module";
import { AccountingModule } from "../accounting/accounting.module";
import { ImportController } from "./import.controller";
import { ImportService } from "./import.service";

/**
 * ماژول ورود گروهی.
 *
 * چرا وابسته به دو ماژول موجود: موجودی فقط از `InventoryService.moveInTx` و
 * سند فقط از `JournalService.postOrNotifyInTx` نوشته می‌شود؛ هیچ مسیر موازی
 * برای ledger/دفتر در این ماژول باز نمی‌شود.
 */
@Module({
  imports: [PrismaModule, InventoryModule, AccountingModule],
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
