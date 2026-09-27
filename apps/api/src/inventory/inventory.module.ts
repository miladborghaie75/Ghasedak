import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AccountingModule } from "../accounting/accounting.module";
import { EventsModule } from "../events/events.module";
import { TreasuryModule } from "../treasury/treasury.module";
import { ChecksModule } from "../checks/checks.module";
import { InventoryService } from "./inventory.service";
import { InventoryOpsService } from "./inventory-ops.service";
import { InventoryReportsService } from "./inventory-reports.service";
import { InventorySettingsService } from "./inventory-settings.service";
import { PurchasingService } from "./purchasing.service";
import { VendorNotifyService } from "./vendor-notify.service";
import { InventoryController } from "./inventory.controller";
import { PurchasingController } from "./purchasing.controller";

@Module({
  imports: [PrismaModule, AccountingModule, EventsModule, TreasuryModule, ChecksModule],
  providers: [InventoryService, InventoryOpsService, InventoryReportsService, InventorySettingsService, PurchasingService, VendorNotifyService],
  controllers: [InventoryController, PurchasingController],
  exports: [InventoryService, InventoryOpsService, InventoryReportsService, InventorySettingsService, PurchasingService, VendorNotifyService],
})
export class InventoryModule {}
