import { Module, type NestModule, MiddlewareConsumer } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { SessionMiddleware } from "./session.middleware";

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionMiddleware],
  exports: [AuthService, SessionMiddleware],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SessionMiddleware).forRoutes("*");
  }
}
