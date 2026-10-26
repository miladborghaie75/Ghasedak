import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { PaymentsModule } from "../payments/payments.module";
import { InventoryModule } from "../inventory/inventory.module";
import { AccountingModule } from "../accounting/accounting.module";
import { PricingModule } from "../pricing/pricing.module";
import { EventsModule } from "../events/events.module";
import { HealthModule } from "../health/health.module";
import { AdminPanelController } from "./admin-panel.controller";
import { DashboardController } from "./dashboard.controller";
import { PublicThemeController } from "./public-theme.controller";
import { CapabilitiesController } from "./capabilities.controller";
import { AdminAssistantController } from "./admin-assistant.controller";
import { MediaServeController } from "./media-serve.controller";
import { CredentialsController } from "./credentials.controller";
import { CredentialsService } from "./credentials.service";
import { BackupStatusController } from "./backup-status.controller";
import { DiagnosticsController } from "./diagnostics.controller";
import { DataHealthController } from "./data-health.controller";
import { DataHealthService } from "./data-health.service";
import { PaymentGatewayController } from "./payment-gateway.controller";
import { ZarinpalProvider } from "../payments/zarinpal.provider";

@Module({
  imports: [PrismaModule, InventoryModule, AccountingModule, PricingModule, EventsModule, HealthModule, PaymentsModule],
  controllers: [AdminPanelController, DashboardController, PublicThemeController, CapabilitiesController, AdminAssistantController, MediaServeController, CredentialsController, BackupStatusController, DiagnosticsController, DataHealthController, PaymentGatewayController],
  providers: [CredentialsService, DataHealthService],
})
export class AdminPanelModule {}
