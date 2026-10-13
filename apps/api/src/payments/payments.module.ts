import { Module, forwardRef } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { InventoryModule } from "../inventory/inventory.module";
import { AccountingModule } from "../accounting/accounting.module";
import { TreasuryModule } from "../treasury/treasury.module";
import { PaymentsService } from "./payments.service";
import { PaymentsController } from "./payments.controller";
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
  ],
  controllers: [PaymentsController, SettlementController],
  providers: [PaymentsService, SettlementService, ZarinpalProvider, MockPaymentProvider],
  exports: [PaymentsService, SettlementService, ZarinpalProvider],
})
export class PaymentsModule {}
