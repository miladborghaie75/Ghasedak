import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";

/**
 * بند ۳ — بازیابی رمز (ادمین + مشتری)
 * اصول: توکن ۲۵۶بیتی یک‌بارمصرف؛ فقط hash در DB (بند ۴۵)؛ انقضای ۳۰ دقیقه؛
 * مصرف = invalidate همهٔ sessionهای فعال آن کاربر (logout همه‌جا)؛
 * پاسخ درخواست همیشه یکسان است (بدون افشای وجود/نبودن حساب — enumeration-safe)؛
 * ارسال از طریق صف Notification (SMS/EMAIL) — بدون credential فقط QUEUED می‌ماند (بند ۱۱۱).
 */
export const RESET_TTL_MS = 30 * 60 * 1000;
const MAX_ACTIVE_PER_USER = 5;

export type ResetChannel = "email" | "sms";

export interface ResetRequestResult {
  requested: true;
  channel: ResetChannel;
  sentTo: string;
  /** در dev/test فقط: توکن خام برای اثبات چرخه بدون SMTP واقعی (هرگز در prod ست نمی‌شود) */
  devToken?: string;
}

@Injectable()
export class PasswordResetService {
  constructor(private readonly prisma: PrismaService) {}

  static hashToken(token: string): string {
    return createHash("sha256").update(`${token}:ghasedak-reset`).digest("hex");
  }

  /** hash گذرواژهٔ جدید — همان قالب scrypt ورود (auth.service) */
  static hashPassword(password: string): string {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 }).toString("hex");
    return `scrypt$${salt}$${hash}`;
  }

  /** درخواست بازیابی — پاسخ همیشه یکسان؛ پیام به صف Notification می‌رود */
  async request(input: {
    purpose: "admin" | "customer";
    identifier: string;
    /**
     * کانال انتخابی کاربر (گام ۱۴). خالی = پیش‌فرض نقش: ادمین ایمیل، مشتری پیامک.
     *
     * چرا هیچ‌وقت بی‌اطلاع کاربر به کانال دیگر نمی‌افتیم: اگر کاربر «ایمیل» را
     * زده و کد پیامکی بیاید، فکر می‌کند ایمیل آمده و اشکال را جای دیگری
     * می‌جوید. پس یا همان کانال انتخاب‌شده کار می‌کند یا هیچ کدی ساخته نمی‌شود
     * (با همان پاسخ عمومی ضد enumeration).
     */
    channel?: ResetChannel;
  }): Promise<ResetRequestResult> {
    const { purpose, identifier } = input;
    const id = identifier.trim();
    const channel: ResetChannel = input.channel ?? (purpose === "admin" ? "email" : "sms");
    if (input.channel === "sms" && purpose === "admin") {
      throw new BadRequestException({
        code: "CHANNEL_NOT_ALLOWED",
        message: "بازیابی رمز پنل فقط با ایمیل انجام می‌شود.",
        fieldErrors: { channel: ["برای پنل مدیریت، ایمیل را انتخاب کنید."] },
      });
    }
    const isEmail = channel === "email";
    if (isEmail ? !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(id) : !/^09\d{9}$/.test(id)) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        fieldErrors: { identifier: [isEmail ? "ایمیل معتبر نیست." : "موبایل ۱۱ رقم با ۰۹."] },
      });
    }

    // مشتری با ایمیل: حساب با همان ایمیل؛ مشتری با پیامک: همان قاعدهٔ قبلی
    const user = purpose === "customer"
      ? isEmail
        ? await this.prisma.user.findFirst({ where: { email: id, role: "CUSTOMER", status: "ACTIVE" } })
        : await this.prisma.user.findFirst({ where: { role: "CUSTOMER", mobile: id, status: "ACTIVE" } })
      : await this.prisma.user.findUnique({ where: { email: id } });

    // پاسخ یکسان برای حساب موجود/ناموجود — ضد enumeration (بند ۶۵)
    const generic: ResetRequestResult = { requested: true, channel, sentTo: id };
    if (!user || user.status !== "ACTIVE" || !user.passwordHash) {
      // مشتریِ بدون گذرواژه (یا بدون ایمیل ثبت‌شده) هیچ ردیفی نمی‌گیرد — همان پاسخ
      return generic;
    }

    // سقف توکن فعال ضد اسپم
    const actives = await this.prisma.passwordResetToken.count({
      where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (actives >= MAX_ACTIVE_PER_USER) {
      return generic; // بی‌صدا — بدون افشا
    }

    const token = randomBytes(32).toString("hex");
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: PasswordResetService.hashToken(token),
        purpose,
        channel,
        sentTo: id,
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      },
    });

    const message =
      purpose === "admin"
        ? `بازیابی رمز پنل قاصدک — کد/لینک یک‌بارمصرف (۳۰ دقیقه): ${token}`
        : `بازیابی رمز قاصدک — کد یک‌بارمصرف (۳۰ دقیقه): ${token}`;

    await this.prisma.notification.create({
      data: {
        channel: isEmail ? "EMAIL" : "SMS",
        templateKey: `password-reset:${purpose}`,
        to: id,
        payload: { message, purpose, channel },
      },
    });

    // فقط در محیط غیر-prod: توکن خام برای تست چرخه بدون SMTP/SMS واقعی
    const devToken = process.env.NODE_ENV === "production" ? undefined : token;
    return devToken ? { ...generic, devToken } : generic;
  }

  /** مصرف توکن + تغییر رمز + بی‌اعتبارسازی همهٔ sessionها */
  async reset(input: { purpose: "admin" | "customer"; token: string; newPassword: string }): Promise<{ ok: true }> {
    const { purpose, token, newPassword } = input;
    if (typeof newPassword !== "string" || newPassword.length < 8) {
      throw new BadRequestException({ code: "WEAK_PASSWORD", message: "رمز جدید حداقل ۸ کاراکتر باشد." });
    }
    const row = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: PasswordResetService.hashToken(token) },
    });
    if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt < new Date()) {
      throw new UnauthorizedException({ code: "RESET_TOKEN_INVALID", message: "توکن نامعتبر یا منقضی است." });
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: row.userId },
        data: { passwordHash: PasswordResetService.hashPassword(newPassword) },
      }),
      this.prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      // logout همه‌جا — همهٔ sessionهای فعال این کاربر بی‌اعتبار می‌شوند
      this.prisma.adminSession.deleteMany({ where: { userId: row.userId } }),
    ]);
    return { ok: true };
  }

  /** پاک‌سازی توکن‌های منقضی (فراخوانی دوره‌ای/تستی) */
  async purgeExpired(): Promise<number> {
    const r = await this.prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    return r.count;
  }
}
