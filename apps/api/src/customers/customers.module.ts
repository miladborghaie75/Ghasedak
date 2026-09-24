import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { CrmService } from "./crm.service";
import { CrmController } from "./crm.controller";

@Module({
  imports: [PrismaModule],
  providers: [CrmService],
  controllers: [CrmController],
})
export class CustomersModule {}
