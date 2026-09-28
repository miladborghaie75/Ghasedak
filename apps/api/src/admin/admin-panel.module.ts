import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { InventoryModule } from "../inventory/inventory.module";
import { AccountingModule } from "../accounting/accounting.module";
import { PricingModule } from "../pricing/pricing.module";
import { EventsModule } from "../events/events.module";
import { AdminPanelController } from "./admin-panel.controller";
import { PublicThemeController } from "./public-theme.controller";
import { CapabilitiesController } from "./capabilities.controller";
import { MediaServeController } from "./media-serve.controller";

@Module({
  imports: [PrismaModule, InventoryModule, AccountingModule, PricingModule, EventsModule],
  controllers: [AdminPanelController, PublicThemeController, CapabilitiesController, MediaServeController],
})
export class AdminPanelModule {}
