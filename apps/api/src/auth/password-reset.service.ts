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

export interface ResetRequestResult {
  requested: true;
  channel: "email" | "sms";
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
    identifier: string; // email (admin) یا mobile (customer)
  }): Promise<ResetRequestResult> {
    const { purpose, identifier } = input;
    const id = identifier.trim();
    const isEmail = purpose === "admin";
    if (isEmail ? !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(id) : !/^09\d{9}$/.test(id)) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        fieldErrors: { identifier: [isEmail ? "ایمیل معتبر نیست." : "موبایل ۱۱ رقم با ۰۹."] },
      });
    }

    const user = isEmail
      ? await this.prisma.user.findUnique({ where: { email: id } })
      : await this.prisma.user.findFirst({
          where: { role: "CUSTOMER", mobile: id, status: "ACTIVE" },
        });

    // پاسخ یکسان برای حساب موجود/ناموجود — ضد enumeration (بند ۶۵)
    const generic: ResetRequestResult = { requested: true, channel: isEmail ? "email" : "sms", sentTo: id };
    if (!user || user.status !== "ACTIVE" || (!isEmail && !user.passwordHash)) {
      // برای مشتریِ بدون گذرواژه هم هیچ ردیفی ساخته نمی‌شود — همان پاسخ
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
        channel: isEmail ? "email" : "sms",
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
        payload: { message, purpose },
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
