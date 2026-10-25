import { Module, forwardRef } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { InventoryModule } from "../inventory/inventory.module";
import { AccountingModule } from "../accounting/accounting.module";
import { TreasuryModule } from "../treasury/treasury.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { PaymentsService } from "./payments.service";
import { PaymentsController } from "./payments.controller";
import { C2cService } from "./c2c.service";
import { C2cController } from "./c2c.controller";
import { SettlementService } from "./settlement.service";
import { SettlementController } from "./settlement.controller";
import { ZarinpalProvider } from "./zarinpal.provider";
import { MockPaymentProvider } from "./mock.provider";

/**
 * `forwardRef` روی AccountingModule چون آن هم PaymentsModule را می‌خواهد
 * (سند فروش آنلاین). بدون این، بوت شکست می‌خورد.
 */
@Module({
  imports: [
    PrismaModule,
    AuthModule,
    InventoryModule,
    forwardRef(() => AccountingModule),
    TreasuryModule,
    AnalyticsModule,
  ],
  controllers: [PaymentsController, SettlementController, C2cController],
  providers: [PaymentsService, C2cService, SettlementService, ZarinpalProvider, MockPaymentProvider],
  exports: [PaymentsService, C2cService, SettlementService, ZarinpalProvider],
})
export class PaymentsModule {}
