import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ShippingService } from "./shipping.service";
import { ShippingController } from "./shipping.controller";

@Module({
  imports: [PrismaModule],
  controllers: [ShippingController],
  providers: [ShippingService],
})
export class ShippingModule {}
