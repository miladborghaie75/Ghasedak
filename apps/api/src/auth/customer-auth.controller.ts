import { Body, Controller, HttpCode, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { CustomerAuthService, type CustomerSession } from "./customer-auth.service";
import { SESSION_COOKIE } from "./auth.service";

/**
 * مسیرهای عمومی حساب مشتری در فروشگاه (بدون نیاز به نشست قبلی):
 *   POST /api/v1/auth/register        ثبت‌نام با موبایل + رمز (ایمیل اختیاری)
 *   POST /api/v1/auth/login           ورود با ایمیل + رمز (مشتری‌ها؛ ادمین همان مسیر خودش را دارد)
 *   POST /api/v1/auth/otp/request     درخواست کد ورود با موبایل
 *   POST /api/v1/auth/otp/verify      تأیید کد → نشست (در نبود حساب، ساخته می‌شود)
 *
 * کوکی `ghasedak_admin_session` مشترک همهٔ نشست‌هاست (روی هاست خودش scope شده)؛
 * فروشگاه هم همین را می‌خواند/می‌گذارد.
 */
@Controller("auth")
export class CustomerAuthController {
  constructor(private readonly customers: CustomerAuthService) {}

  private issue(res: Response, s: CustomerSession): CustomerSession {
    res.cookie(SESSION_COOKIE, s.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      expires: s.expiresAt,
      path: "/",
    });
    return s;
  }

  @Post("register")
  @HttpCode(200)
  async register(@Body() body: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    return this.issue(res, await this.customers.register(body ?? {}));
  }

  @Post("otp/request")
  @HttpCode(200)
  async otpRequest(@Body() body: { mobile?: unknown }) {
    return this.customers.requestOtp(body?.mobile);
  }

  @Post("otp/verify")
  @HttpCode(200)
  async otpVerify(
    @Body() body: { mobile?: unknown; code?: unknown },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.issue(res, await this.customers.verifyOtp(body?.mobile, body?.code));
  }
}
