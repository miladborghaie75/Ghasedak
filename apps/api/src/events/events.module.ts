import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { EventBusService } from "./event-bus.service";

@Module({
  imports: [PrismaModule],
  providers: [EventBusService],
  exports: [EventBusService],
})
export class EventsModule {}
