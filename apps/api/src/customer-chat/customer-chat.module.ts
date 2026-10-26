import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { CustomerChatController } from "./customer-chat.controller";
import { CustomerChatService } from "./customer-chat.service";

@Module({
  imports: [PrismaModule],
  controllers: [CustomerChatController],
  providers: [CustomerChatService],
})
export class CustomerChatModule {}
