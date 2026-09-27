import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AccountingModule } from "../accounting/accounting.module";
import { ChecksService } from "./checks.service";
import { ReminderService } from "./reminder.service";
import { ChecksController } from "./checks.controller";

/**
 * فاز ۹ — Wave 2: ماژول دامنهٔ چک.
 * ChecksService export می‌شود تا POS/خرید در همان تراکنش خودشان چک بسازند (createInTx)
 * و هیچ implementation موازی‌ای شکل نگیرد (Existing Capability First).
 */
@Module({
  imports: [PrismaModule, AccountingModule],
  controllers: [ChecksController],
  providers: [ChecksService, ReminderService],
  exports: [ChecksService, ReminderService],
})
export class ChecksModule {}
