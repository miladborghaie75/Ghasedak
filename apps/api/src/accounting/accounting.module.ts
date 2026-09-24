import { Module } from "@nestjs/common";
import { AccountingController } from "./accounting.controller";
import { AccountingReportsController } from "./accounting-reports.controller";
import { JournalService } from "./journal.service";

@Module({
  controllers: [AccountingController, AccountingReportsController],
  providers: [JournalService],
  exports: [JournalService],
})
export class AccountingModule {}
