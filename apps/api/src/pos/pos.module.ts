import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { InventoryModule } from "../inventory/inventory.module";
import { AccountingModule } from "../accounting/accounting.module";
import { PricingModule } from "../pricing/pricing.module";
import { PosService } from "./pos.service";
import { PosController } from "./pos.controller";

@Module({
  imports: [PrismaModule, InventoryModule, AccountingModule, PricingModule],
  controllers: [PosController],
  providers: [PosService],
})
export class PosModule {}
