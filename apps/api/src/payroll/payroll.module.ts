import { Module, forwardRef } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AccountingModule } from "../accounting/accounting.module";
import { PayrollService } from "./payroll.service";
import { PayrollController } from "./payroll.controller";

/**
 * `forwardRef` چون AccountingModule هم PayrollModule را می‌خواهد
 * (سند اختتامیه ممکن است حقوق پرداخت‌نشده را ببیند).
 */
@Module({
  imports: [PrismaModule, forwardRef(() => AccountingModule)],
  controllers: [PayrollController],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
