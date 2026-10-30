import { Module, type NestModule, MiddlewareConsumer } from "@nestjs/common";
import { EventsModule } from "../events/events.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { CustomerAuthController } from "./customer-auth.controller";
import { CustomerAuthService } from "./customer-auth.service";
import { SessionMiddleware } from "./session.middleware";
import { PasswordResetController } from "./password-reset.controller";
import { PasswordResetService } from "./password-reset.service";

/**
 * علاوه بر ورود ادمین، مسیرهای حساب مشتری فروشگاه هم همین‌جا ثبت می‌شوند:
 * `register` + `otp/request` + `otp/verify` (CustomerAuthController).
 * EventsModule برای SmsProvidersService لازم است تا OTP واقعی ارسال شود.
 */
@Module({
  imports: [EventsModule],
  controllers: [AuthController, CustomerAuthController, PasswordResetController],
  providers: [AuthService, CustomerAuthService, SessionMiddleware, PasswordResetService],
  exports: [AuthService, SessionMiddleware, PasswordResetService],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SessionMiddleware).forRoutes("*");
  }
}
