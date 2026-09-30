import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { EventBusService } from "./event-bus.service";
import { NotificationDispatcherService } from "./notification-dispatcher.service";
import { SmsProvidersService } from "./sms-providers.service";

@Module({
  imports: [PrismaModule],
  providers: [EventBusService, NotificationDispatcherService, SmsProvidersService],
  exports: [EventBusService, NotificationDispatcherService, SmsProvidersService],
})
export class EventsModule {}
