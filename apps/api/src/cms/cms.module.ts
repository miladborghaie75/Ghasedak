import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { CmsService, CmsAdminController, CmsPublicController, CmsPublicPagesController } from "./cms.controller";

/** ماژول صفحه‌ساز — مدیریت صفحه‌ها + خواندن عمومی برای فروشگاه */
@Module({
  imports: [PrismaModule],
  controllers: [CmsAdminController, CmsPublicController, CmsPublicPagesController],
  providers: [CmsService],
  exports: [CmsService],
})
export class CmsModule {}