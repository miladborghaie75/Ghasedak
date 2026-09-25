import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { EventsModule } from "../events/events.module";
import { PricingService } from "./pricing.service";
import { PricingController } from "./pricing.controller";

@Module({
  imports: [PrismaModule, EventsModule],
  providers: [PricingService],
  controllers: [PricingController],
  exports: [PricingService],
})
export class PricingModule {}
