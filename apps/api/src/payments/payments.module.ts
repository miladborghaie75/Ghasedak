import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { InventoryModule } from "../inventory/inventory.module";
import { AccountingModule } from "../accounting/accounting.module";
import { PaymentsService } from "./payments.service";
import { PaymentsController } from "./payments.controller";
import { ZarinpalProvider } from "./zarinpal.provider";
import { MockPaymentProvider } from "./mock.provider";

@Module({
  imports: [PrismaModule, AuthModule, InventoryModule, AccountingModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, ZarinpalProvider, MockPaymentProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
