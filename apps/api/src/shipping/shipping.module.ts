import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { EventsModule } from "../events/events.module";
import { ShippingService } from "./shipping.service";
import { ShippingController } from "./shipping.controller";
import { ShippingPublicController } from "./shipping-public.controller";

@Module({
  imports: [PrismaModule, EventsModule],
  controllers: [ShippingController, ShippingPublicController],
  providers: [ShippingService],
})
export class ShippingModule {}
