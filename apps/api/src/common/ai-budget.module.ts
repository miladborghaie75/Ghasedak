import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AiBudgetService } from "./ai-budget.service";

/** سراسری چون هم admin panel و هم customer-chat از سقفِ سربار مشترک استفاده می‌کنند. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [AiBudgetService],
  exports: [AiBudgetService],
})
export class AiBudgetModule {}
