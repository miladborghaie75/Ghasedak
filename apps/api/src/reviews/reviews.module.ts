import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { EventsModule } from "../events/events.module";
import { ReviewsService } from "./reviews.service";
import { PublicReviewsController } from "./public-reviews.controller";
import { AdminReviewsController } from "./admin-reviews.controller";

/** ماژول نظرات (گام ۱۱ — بند ۴۱/۱۰۸) */
@Module({
  imports: [PrismaModule, EventsModule], // EventsModule → SmsProvidersService برای OTP واقعی
  controllers: [PublicReviewsController, AdminReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
