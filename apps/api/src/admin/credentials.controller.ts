import { BadRequestException, Body, Controller, Get, Post } from "@nestjs/common";
import { CredentialsService } from "./credentials.service";

/**
 * فاز پس از ۱۲ — جایگاه ورود credential ادمین (بند ۴۵/۱۱۱)
 * ============================================================
 * credential محرمانه هرگز در DB ذخیره نمی‌شود و هرگز در پاسخ API برنمی‌گردد:
 *  - POST /admin/capabilities/credentials → نوشتن/به‌روزرسانی کلیدها در apps/api/.env.local
 *    (خارج از git؛ فقط فرایند API هنگام بوت می‌خواند — لودر در main.ts)
 *  - GET  /admin/capabilities/credentials → فقط وضعیت ماسک‌شده («abc…wxyz» یا خالی)
 *
 * منطق فایل/اعمال در CredentialsService است (مشترک با اندپوینت کلید پیامک).
 */
@Controller("admin/capabilities/credentials")
export class CredentialsController {
  constructor(private readonly credentials: CredentialsService) {}

  /** فقط وضعیت ماسک‌شده — مقدار واقعی هرگز برنمی‌گردد */
  @Get()
  status() {
    return this.credentials.status();
  }

  /** نوشتن/به‌روزرسانی کلیدها — مقدار قبلی با کلید خالی "" پاک می‌شود */
  @Post()
  save(@Body() body: Record<string, string>) {
    return this.credentials.save(body);
  }
}
