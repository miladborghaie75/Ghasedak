import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { InventoryModule } from "../inventory/inventory.module";
import { TreasuryModule } from "../treasury/treasury.module";
import { ReturnsService } from "./returns.service";
import { ReturnsController } from "./returns.controller";

@Module({
  imports: [PrismaModule, InventoryModule, TreasuryModule],
  controllers: [ReturnsController],
  providers: [ReturnsService],
})
export class ReturnsModule {}
