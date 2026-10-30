import { BadRequestException, Injectable } from "@nestjs/common";
import { randomInt } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { SmsProvidersService } from "../events/sms-providers.service";
import { AuthService, hashPasswordArgon2id } from "./auth.service";

/**
 * حساب مشتری در فروشگاه (گام «ورود/ثبت‌نام فروشگاه»)
 * ---------------------------------------------------------------
 * چرا جدا از `AuthService`: ورود ادمین فقط ایمیل+رمز است، ولی مشتری دو راه
 * دارد (ایمیل+رمز، موبایل+کد یک‌بارمصرف) و باید رکورد `Customer` (مالک آدرس‌ها و
 * سبد) را هم بسازد. هر دو مسیر در پایان به **همان** `AuthService.startSession`
 * می‌رسند، پس قالب نشست یکی است.
 *
 * قواعد مهم:
 *  - ثبت‌نام همیشه با **موبایل** است چون `Customer.mobile` یکتاست و آدرس/سفارش
 *    به همان گره می‌خورند؛ ایمیل اختیاری است (برای ورود و کانال ایمیلِ بازیابی رمز).
 *  - OTP اینجا با purpose جدا (`customer_login`) از نظرات (`review`) جداست تا
 *    کدهای دو جریان قابل تقلید نباشند.
 *  - بدون کلید پیامک هیچ کدی ارسال نمی‌شود و خطای صریح برمی‌گردد (بند ۱۱۱).
 */

const MOBILE_RE = /^09\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const OTP_TTL_MIN = 5;
const OTP_MAX_ATTEMPTS = 5;
const OTP_COOLDOWN_SEC = 60;
const OTP_HOURLY_MAX = 5;
const PASSWORD_MIN = 8;

export const CUSTOMER_OTP_PURPOSE = "customer_login";

/** نرمال‌سازی موبایل (۰۹… / ۹۸… / فارسی) — همان قاعدهٔ نظرات */
export function normalizeMobile(raw: unknown): string {
  const m = String(raw ?? "")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[\s-]/g, "");
  return m.startsWith("98") ? `0${m.slice(2)}` : m;
}

export interface RegisterInput {
  name?: unknown;
  email?: unknown;
  mobile?: unknown;
  password?: unknown;
}

export interface CustomerSession {
  token: string;
  expiresAt: Date;
  user: { id: string; name: string | null; email: string | null; mobile: string; role: string };
}

@Injectable()
export class CustomerAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsProvidersService,
    private readonly auth: AuthService,
  ) {}

  // ------------------------------------------------------- ثبت‌نام (ایمیل/رمز)

  async register(input: RegisterInput): Promise<CustomerSession> {
    const mobile = normalizeMobile(input.mobile);
    const email = String(input.email ?? "").trim().toLowerCase();
    const name = String(input.name ?? "").trim();
    const password = String(input.password ?? "");

    const fieldErrors: Record<string, string[]> = {};
    if (!MOBILE_RE.test(mobile)) fieldErrors.mobile = ["شمارهٔ موبایل معتبر نیست (مثال: ۰۹۱۲۳۴۵۶۷۸۹)."];
    if (email && !EMAIL_RE.test(email)) fieldErrors.email = ["ایمیل معتبر نیست."];
    if (name.length > 60) fieldErrors.name = ["نام حداکثر ۶۰ حرف است."];
    if (password.length < PASSWORD_MIN) fieldErrors.password = [`رمز باید حداقل ${PASSWORD_MIN} نویسه باشد.`];
    else if (!/[A-Za-z]/.test(password) || !/\d/.test(password))
      fieldErrors.password = ["رمز باید حداقل یک حرف و یک عدد داشته باشد."];
    if (Object.keys(fieldErrors).length) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", fieldErrors });
    }

    const dup = await this.prisma.user.findFirst({
      where: { OR: [{ mobile }, ...(email ? [{ email }] : [])] },
      select: { id: true },
    });
    if (dup) {
      throw new BadRequestException({
        code: "ACCOUNT_EXISTS",
        message: "برای این شماره/ایمیل حسابی وجود دارد؛ وارد شوید یا رمز را بازیابی کنید.",
        fieldErrors: { mobile: ["این شماره قبلاً ثبت شده است."] },
      });
    }

    const passwordHash = await hashPasswordArgon2id(password);
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          mobile,
          ...(email ? { email } : {}),
          ...(name ? { name } : {}),
          passwordHash,
          role: "CUSTOMER",
          status: "ACTIVE",
        },
      });
      // Customer مالک آدرس/سفارش/سبد است — با همان موبایلِ یکتای ثبت‌نام
      await tx.customer.create({ data: { userId: u.id, mobile, ...(name ? { name } : {}) } });
      return u;
    });

    const session = await this.auth.startSession(user.id);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { ...session, user: await this.publicUser(user.id) };
  }

  // ------------------------------------------------------- ورود با موبایل + OTP

  /** ساخت کد — جدا از ارسال تا تست بتواند کد واقعی DB را بگیرد (الگوی نظرات) */
  async createOtp(mobile: string): Promise<string> {
    const code = String(randomInt(100_000, 1_000_000));
    await this.prisma.otpCode.create({
      data: {
        mobile,
        code,
        purpose: CUSTOMER_OTP_PURPOSE,
        expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60_000),
      },
    });
    return code;
  }

  async requestOtp(rawMobile: unknown): Promise<{ ok: true }> {
    const mobile = normalizeMobile(rawMobile);
    if (!MOBILE_RE.test(mobile)) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        fieldErrors: { mobile: ["شمارهٔ موبایل معتبر نیست (مثال: ۰۹۱۲۳۴۵۶۷۸۹)."] },
      });
    }
    const hourAgo = new Date(Date.now() - 3_600_000);
    const recent = await this.prisma.otpCode.count({
      where: { mobile, purpose: CUSTOMER_OTP_PURPOSE, createdAt: { gte: hourAgo } },
    });
    if (recent >= OTP_HOURLY_MAX) {
      throw new BadRequestException({ code: "OTP_RATE", message: "تعداد درخواست کد زیاد است؛ کمی بعد تلاش کنید." });
    }
    const cooldownAgo = new Date(Date.now() - OTP_COOLDOWN_SEC * 1000);
    const last = await this.prisma.otpCode.findFirst({
      where: { mobile, purpose: CUSTOMER_OTP_PURPOSE, createdAt: { gte: cooldownAgo }, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (last) {
      throw new BadRequestException({ code: "OTP_COOLDOWN", message: "کد قبلی هنوز معتبر است؛ همان را وارد کنید." });
    }

    const code = await this.createOtp(mobile);
    const setting = await this.prisma.setting.findUnique({ where: { key: "sms" } });
    const sender = ((setting?.value ?? {}) as { sender?: string }).sender ?? null;
    const r = await this.sms.send(
      mobile,
      `کد ورود به قاصدک: ${code}\nاین کد ${OTP_TTL_MIN} دقیقه اعتبار دارد؛ کسی آن را نفرستد.`,
      sender,
    );
    if (r.state !== "SENT") {
      throw new BadRequestException({
        code: "SMS_NOT_SENT",
        message:
          r.state === "QUEUED"
            ? "سرویس پیامک تنظیم نشده است؛ فعلاً ورود با کد ممکن نیست. (بند ۱۱۱ — بدون ارسال جعلی)"
            : `ارسال پیامک ناموفق بود؛ دوباره تلاش کنید. ${r.error ?? ""}`.trim(),
      });
    }
    return { ok: true };
  }

  /**
   * تأیید کد → ورود. اگر حسابی با این موبایل نباشد ساخته می‌شود
   * (ثبت‌نامِ بی‌دردسرِ الگوی فروشگاه ایرانی: شماره + کد = حساب).
   */
  async verifyOtp(rawMobile: unknown, rawCode: unknown): Promise<CustomerSession> {
    const mobile = normalizeMobile(rawMobile);
    const code = String(rawCode ?? "").trim();
    if (!MOBILE_RE.test(mobile) || !/^\d{6}$/.test(code)) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "شماره یا کد نادرست است." });
    }
    const row = await this.prisma.otpCode.findFirst({
      where: { mobile, purpose: CUSTOMER_OTP_PURPOSE, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    const fail = (msg: string) => new BadRequestException({ code: "OTP_INVALID", message: msg });
    if (!row) throw fail("کدی برای این شماره پیدا نشد؛ دوباره درخواست کنید.");
    if (row.expiresAt.getTime() < Date.now()) throw fail("کد منقضی شده؛ دوباره درخواست کنید.");
    if (row.attempts >= OTP_MAX_ATTEMPTS) throw fail("تعداد تلاش‌ها زیاد بود؛ کد جدید بگیرید.");
    if (row.code !== code) {
      await this.prisma.otpCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
      throw fail("کد نادرست است.");
    }
    await this.prisma.otpCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });

    let user = await this.prisma.user.findFirst({
      where: { mobile, role: "CUSTOMER", status: "ACTIVE" },
    });
    if (!user) {
      user = await this.prisma.$transaction(async (tx) => {
        const u = await tx.user.create({ data: { mobile, role: "CUSTOMER", status: "ACTIVE" } });
        await tx.customer.create({ data: { userId: u.id, mobile } });
        return u;
      });
    } else {
      // حساب قدیمیِ بدون رکورد Customer (مثلاً ساخته‌شده قبل از این گام) → ترمیم
      await this.prisma.customer.upsert({
        where: { mobile },
        update: { userId: user.id },
        create: { userId: user.id, mobile },
      });
    }

    const session = await this.auth.startSession(user.id);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { ...session, user: await this.publicUser(user.id) };
  }

  /** پروفایل عمومی برای پاسخ‌های ورود/ثبت‌نام — هرگز hash یا PII اضافی */
  private async publicUser(id: string): Promise<CustomerSession["user"]> {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      mobile: u.mobile ?? "",
      role: u.role,
    };
  }
}
