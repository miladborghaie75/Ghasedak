import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AccountController } from "./account.controller";

/** ماژول «حساب من»ی مشتری — فقط خواندن/نوشتن دادهٔ خودِ مشتری از روی نشست */
@Module({
  imports: [PrismaModule],
  controllers: [AccountController],
})
export class AccountModule {}
