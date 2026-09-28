import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { EventBusService } from "./event-bus.service";
import { NotificationDispatcherService } from "./notification-dispatcher.service";

@Module({
  imports: [PrismaModule],
  providers: [EventBusService, NotificationDispatcherService],
  exports: [EventBusService, NotificationDispatcherService],
})
export class EventsModule {}
