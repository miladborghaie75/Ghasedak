import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { EventBusService } from "./event-bus.service";
import { NotificationDispatcherService } from "./notification-dispatcher.service";
import { SmsProvidersService } from "./sms-providers.service";
import { WebhooksController } from "./webhooks.controller";
import { WebhooksService } from "./webhooks.service";

@Module({
  imports: [PrismaModule],
  controllers: [WebhooksController],
  providers: [EventBusService, NotificationDispatcherService, SmsProvidersService, WebhooksService],
  exports: [EventBusService, NotificationDispatcherService, SmsProvidersService, WebhooksService],
})
export class EventsModule {}
