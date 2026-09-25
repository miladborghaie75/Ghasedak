import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AccountingModule } from "../accounting/accounting.module";
import { TreasuryService } from "./treasury.service";
import { TreasuryController } from "./treasury.controller";

@Module({
  imports: [PrismaModule, AccountingModule],
  controllers: [TreasuryController],
  providers: [TreasuryService],
  exports: [TreasuryService],
})
export class TreasuryModule {}
