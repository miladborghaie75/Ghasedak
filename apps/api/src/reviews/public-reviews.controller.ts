import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { ReviewsService, type SubmitInput } from "./reviews.service";

/**
 * API عمومی نظرات — بدون احراز هویت؛ ورود مهمان با OTP موبایل.
 * نمایش: فقط APPROVED و بدون PII. ثبت: همیشه PENDING تا تأیید ادمین.
 * ضداسپم مسیر: RateLimitMiddleware (برگشت reviews) + سهمیه در سرویس.
 */
@Controller("reviews")
export class PublicReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  /** درخواست کد تأیید موبایل — ارسال واقعی SMS؛ بدون کلید اپراتور خطای صریح */
  @Post("otp/request")
  @HttpCode(200)
  requestOtp(@Body() body: { mobile?: string }) {
    return this.reviews.requestOtp(body.mobile);
  }

  /** تأیید کد → توکن یک‌بارمصرف ثبت نظر */
  @Post("otp/verify")
  @HttpCode(200)
  verifyOtp(@Body() body: { mobile?: string; code?: string }) {
    return this.reviews.verifyOtp(body.mobile, body.code);
  }

  /** ثبت نظر → PENDING + بج خریدار واقعی از سفارش PAID */
  @Post("submit")
  @HttpCode(201)
  submit(@Body() body: SubmitInput) {
    return this.reviews.submit(body);
  }

  /** نظرات منتشرشدهٔ یک محصول با خلاصهٔ امتیاز — با اسلاگ (همان آدرس عمومی PDP) */
  @Get("product/:slug")
  forProduct(@Param("slug") slug: string) {
    return this.reviews.publicForProduct(slug);
  }
}
