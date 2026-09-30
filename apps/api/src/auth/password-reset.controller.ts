import { BadRequestException, Body, Controller, HttpCode, Post } from "@nestjs/common";
import { PasswordResetService } from "./password-reset.service";

/**
 * بند ۳ — endpoints عمومی بازیابی رمز (بدون session).
 * rate-limit سبک در-پروسس (بدون وابستگی جدید): پنجرهٔ ۶۰ ثانیه‌ای per-IP+identifier
 * — ضد brute-force و enumeration. در استقرار چندنمایه‌ای، جایگزین: Redis limiter.
 */
const WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimit(key: string, limit: number): void {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  b.count += 1;
  if (b.count > limit) {
    throw new BadRequestException({ code: "RATE_LIMITED", message: "تلاش‌های زیاد — کمی بعد دوباره امتحان کنید." });
  }
}

@Controller("auth/password")
export class PasswordResetController {
  constructor(private readonly resets: PasswordResetService) {}

  /** POST /auth/password/forgot — درخواست توکن (admin: email، customer: mobile) */
  @Post("forgot")
  @HttpCode(200)
  async forgot(@Body() body: { purpose?: "admin" | "customer"; identifier?: string; ip?: string }) {
    const purpose = body.purpose === "customer" ? "customer" : "admin";
    const identifier = String(body.identifier ?? "").trim().toLowerCase();
    if (!identifier) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", fieldErrors: { identifier: ["ایمیل یا موبایل الزامی است."] } });
    }
    rateLimit(`forgot:${identifier}`, 3);
    return this.resets.request({ purpose, identifier });
  }

  /** POST /auth/password/reset — مصرف توکن + رمز جدید */
  @Post("reset")
  @HttpCode(200)
  async reset(@Body() body: { purpose?: "admin" | "customer"; token?: string; newPassword?: string }) {
    const purpose = body.purpose === "customer" ? "customer" : "admin";
    const token = String(body.token ?? "").trim();
    if (!token) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", fieldErrors: { token: ["توکن الزامی است."] } });
    }
    rateLimit(`reset:${token.slice(0, 8)}`, 5);
    return this.resets.reset({ purpose, token, newPassword: String(body.newPassword ?? "") });
  }
}
