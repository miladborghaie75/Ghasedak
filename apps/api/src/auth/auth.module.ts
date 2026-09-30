import { Module, type NestModule, MiddlewareConsumer } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { SessionMiddleware } from "./session.middleware";
import { PasswordResetController } from "./password-reset.controller";
import { PasswordResetService } from "./password-reset.service";

@Module({
  controllers: [AuthController, PasswordResetController],
  providers: [AuthService, SessionMiddleware, PasswordResetService],
  exports: [AuthService, SessionMiddleware, PasswordResetService],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SessionMiddleware).forRoutes("*");
  }
}
