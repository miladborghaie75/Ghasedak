import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { PaymentsModule } from "../payments/payments.module";
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
import { CredentialsService } from "./credentials.service";
import { BackupStatusController } from "./backup-status.controller";
import { DiagnosticsController } from "./diagnostics.controller";
import { PaymentGatewayController } from "./payment-gateway.controller";
import { ZarinpalProvider } from "../payments/zarinpal.provider";

@Module({
  imports: [PrismaModule, InventoryModule, AccountingModule, PricingModule, EventsModule, HealthModule, PaymentsModule],
  controllers: [AdminPanelController, PublicThemeController, CapabilitiesController, MediaServeController, CredentialsController, BackupStatusController, DiagnosticsController, PaymentGatewayController],
  providers: [CredentialsService],
})
export class AdminPanelModule {}
