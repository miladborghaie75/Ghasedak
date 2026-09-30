import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { InventoryModule } from "../inventory/inventory.module";
import { AccountingModule } from "../accounting/accounting.module";
import { PricingModule } from "../pricing/pricing.module";
import { EventsModule } from "../events/events.module";
import { HealthModule } from "../health/health.module";
import { AdminPanelController } from "./admin-panel.controller";
import { PublicThemeController } from "./public-theme.controller";
import { CapabilitiesController } from "./capabilities.controller";
import { MediaServeController } from "./media-serve.controller";
import { CredentialsController } from "./credentials.controller";
import { BackupStatusController } from "./backup-status.controller";
import { DiagnosticsController } from "./diagnostics.controller";

@Module({
  imports: [PrismaModule, InventoryModule, AccountingModule, PricingModule, EventsModule, HealthModule],
  controllers: [AdminPanelController, PublicThemeController, CapabilitiesController, MediaServeController, CredentialsController, BackupStatusController, DiagnosticsController],
})
export class AdminPanelModule {}
