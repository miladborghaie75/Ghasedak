import { BadRequestException, Injectable } from "@nestjs/common";
import type { ReviewStatus } from "@prisma/client";
import { randomInt, randomUUID } from "crypto";
import type { PrismaService } from "../prisma/prisma.service";
import type { SmsProvidersService } from "../events/sms-providers.service";

/**
 * ماژول نظرات (گام ۱۱ — بند ۴۱): چرخهٔ ثبت→PENDING→تأیید ادمین→نمایش.
 *
 * اصول:
 *  - مهمان با تأیید موبایل (OTP واقعی از SMS gateway فعال — بدون کلید، خطای صریح؛ هیچ ارسال جعلی نیست — بند ۱۱۱)
 *  - بج «خریدار واقعی» فقط از منبع حقیقت: سفارش PAID با همان موبایل و همان محصول
 *  - ضداسپم: rate-limit مسیر (middleware) + سهمیهٔ روزانهٔ per-mobile + یک نظر بر موبایل×محصول + طول متن
 *  - PII: موبایل هرگز در پاسخ عمومی برنمی‌گردد؛ فقط نام (یا «مهمان»)
 */

const MOBILE_RE = /^09\d{9}$/;
const OTP_TTL_MIN = 5;
const OTP_MAX_ATTEMPTS = 5;
const OTP_COOLDOWN_SEC = 60; // فاصلهٔ حداقلی بین دو درخواست کد برای یک موبایل
const OTP_HOURLY_MAX = 5; // ضد bombardment: حداکثر کدهای ساعته per mobile
const DAILY_SUBMIT_MAX = 3; // حداکثر نظر روزانه per mobile
const BODY_MIN = 10;
const BODY_MAX = 1500;
const NAME_MAX = 60;
const PUBLIC_LIMIT = 50;

export function normalizeMobile(raw: unknown): string {
  const m = String(raw ?? "").replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[\s-]/g, "");
  return m.startsWith("98") ? `0${m.slice(2)}` : m;
}

export interface SubmitInput {
  slug?: string;
  rating?: number;
  body?: string;
  name?: string;
  mobile?: string;
  otpToken?: string;
}

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsProvidersService,
  ) {}

  // ------------------------------------------------------------- OTP

  /** ساخت کد OTP — جدا از ارسال تا تست بتواند سمت verify را با کد واقعی DB امتحان کند */
  async createOtp(mobile: string, purpose = "review"): Promise<string> {
    const code = String(randomInt(100_000, 1_000_000));
    await this.prisma.otpCode.create({
      data: { mobile, code, purpose, expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60_000) },
    });
    return code;
  }

  /** درخواست کد — ارسال واقعی از اپراتور فعال؛ بدون کلید → خطای صریح (بدون صف و جعل) */
  async requestOtp(rawMobile: unknown): Promise<{ ok: true }> {
    const mobile = normalizeMobile(rawMobile);
    if (!MOBILE_RE.test(mobile)) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        fieldErrors: { mobile: ["شمارهٔ موبایل معتبر نیست (مثال: ۰۹۱۲۳۴۵۶۷۸۹)"] },
      });
    }
    const hourAgo = new Date(Date.now() - 3_600_000);
    const recent = await this.prisma.otpCode.count({ where: { mobile, createdAt: { gte: hourAgo } } });
    if (recent >= OTP_HOURLY_MAX) {
      throw new BadRequestException({ code: "OTP_RATE", message: "تعداد درخواست کد زیاد است؛ کمی بعد تلاش کنید." });
    }
    const cooldownAgo = new Date(Date.now() - OTP_COOLDOWN_SEC * 1000);
    const last = await this.prisma.otpCode.findFirst({
      where: { mobile, createdAt: { gte: cooldownAgo }, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (last) {
      throw new BadRequestException({ code: "OTP_COOLDOWN", message: "کد قبلی هنوز معتبر است؛ همان را وارد کنید." });
    }

    const code = await this.createOtp(mobile);
    const setting = await this.prisma.setting.findUnique({ where: { key: "sms" } });
    const sender = ((setting?.value ?? {}) as { sender?: string }).sender ?? null;
    const r = await this.sms.send(mobile, `کد تأیید ثبت نظر قاصدک: ${code}\nاین کد ${OTP_TTL_MIN} دقیقه اعتبار دارد.`, sender);
    if (r.state !== "SENT") {
      // ارسال نشد → کد بلااستفاده می‌ماند (never consumed)؛ خطا صریح به کاربر
      throw new BadRequestException({
        code: "SMS_NOT_SENT",
        message:
          r.state === "QUEUED"
            ? "سرویس پیامک تنظیم نشده است؛ فعلاً ثبت نظر ممکن نیست. (بند ۱۱۱ — بدون ارسال جعلی)"
            : `ارسال پیامک ناموفق بود؛ دوباره تلاش کنید. ${r.error ?? ""}`.trim(),
      });
    }
    return { ok: true };
  }

  /** تأیید کد → توکن یک‌بارمصرف برای ثبت نظر */
  async verifyOtp(rawMobile: unknown, rawCode: unknown): Promise<{ otpToken: string }> {
    const mobile = normalizeMobile(rawMobile);
    const code = String(rawCode ?? "").trim();
    if (!MOBILE_RE.test(mobile) || !/^\d{6}$/.test(code)) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "شماره یا کد نادرست است.",
      });
    }
    const row = await this.prisma.otpCode.findFirst({
      where: { mobile, purpose: "review", consumedAt: null },
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
    const otpToken = randomUUID();
    await this.prisma.otpCode.update({ where: { id: row.id }, data: { consumedAt: new Date(), token: otpToken } });
    return { otpToken };
  }

  // ------------------------------------------------------------- ثبت نظر

  async submit(input: SubmitInput): Promise<{ id: string; status: ReviewStatus; isVerifiedPurchase: boolean }> {
    const mobile = normalizeMobile(input.mobile);
    const body = String(input.body ?? "").trim();
    const name = String(input.name ?? "").trim();
    const rating = Number(input.rating);
    const fieldErrors: Record<string, string[]> = {};
    if (!input.slug) fieldErrors.slug = ["محصول نامعتبر است."];
    if (!MOBILE_RE.test(mobile)) fieldErrors.mobile = ["شمارهٔ موبایل معتبر نیست."];
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) fieldErrors.rating = ["امتیاز باید بین ۱ تا ۵ باشد."];
    if (body.length < BODY_MIN) fieldErrors.body = [`متن نظر حداقل ${BODY_MIN} حرف باشد.`];
    if (body.length > BODY_MAX) fieldErrors.body = [`متن نظر حداکثر ${BODY_MAX} حرف باشد.`];
    if (name.length > NAME_MAX) fieldErrors.name = ["نام حداکثر ۶۰ حرف باشد."];
    if (!input.otpToken) fieldErrors.otpToken = ["ابتدا موبایل را تأیید کنید."];
    if (Object.keys(fieldErrors).length > 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", fieldErrors });
    }

    // توکن OTP: باید صادرشده و مصرف‌نشده باشد؛ همین‌جا یک‌بار خرج می‌شود
    const otp = await this.prisma.otpCode.findFirst({ where: { token: input.otpToken, mobile, purpose: "review" } });
    if (!otp || !otp.consumedAt || otp.token !== input.otpToken) {
      throw new BadRequestException({ code: "OTP_TOKEN_INVALID", message: "تأیید موبایل نامعتبر است؛ دوباره کد بگیرید." });
    }
    if (otp.consumedAt.getTime() + 30 * 60_000 < Date.now()) {
      throw new BadRequestException({ code: "OTP_TOKEN_EXPIRED", message: "تأیید موبایل منقضی شده؛ دوباره کد بگیرید." });
    }

    const product = await this.prisma.product.findFirst({
      where: { slug: String(input.slug), status: "PUBLISHED" },
      select: { id: true },
    });
    if (!product) throw new BadRequestException({ code: "NOT_FOUND", message: "محصول یافت نشد." });

    // ضداسپم — یک نظر بر موبایل×محصول (PENDING/APPROVED) + سهمیهٔ روزانه
    const existing = await this.prisma.review.findFirst({
      where: { mobile, productId: product.id, status: { in: ["PENDING", "APPROVED"] } },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException({
        code: "DUPLICATE_REVIEW",
        message: "برای این محصول قبلاً نظر ثبت کرده‌اید؛ در انتظار تأیید یا منتشر شده است.",
      });
    }
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const todayCount = await this.prisma.review.count({ where: { mobile, createdAt: { gte: dayStart } } });
    if (todayCount >= DAILY_SUBMIT_MAX) {
      throw new BadRequestException({ code: "SUBMIT_RATE", message: "سهمیهٔ نظرات امروز تکمیل شد؛ فردا تلاش کنید." });
    }

    // بج خریدار واقعی — منبع حقیقت: سفارش PAID با همین موبایل و همین محصول
    const isVerifiedPurchase = await this.hasVerifiedPurchase(mobile, product.id);

    const review = await this.prisma.$transaction(async (tx) => {
      // خرج‌کردن توکن در همان تراکنش ثبت — توکن دوباره استفاده نمی‌شود
      await tx.otpCode.update({ where: { id: otp.id }, data: { token: null } });
      return tx.review.create({
        data: {
          productId: product.id,
          mobile,
          name: name || null,
          rating,
          body,
          status: "PENDING",
          isVerifiedPurchase,
        },
        select: { id: true, status: true, isVerifiedPurchase: true },
      });
    });
    return review;
  }

  /** آیا این موبایل سفارش پرداخت‌شدهٔ حاوی این محصول دارد؟ (ادمین هم از همین برای بازبینی استفاده می‌کند) */
  async hasVerifiedPurchase(mobile: string, productId: string): Promise<boolean> {
    const order = await this.prisma.order.findFirst({
      where: {
        guestMobile: mobile,
        paymentStatus: "PAID",
        items: { some: { variant: { productId } } },
      },
      select: { id: true },
    });
    return order != null;
  }

  // ------------------------------------------------------------- نمایش عمومی

  /** فقط APPROVED؛ بدون PII — خلاصهٔ امتیاز + توزیع ستاره‌ها + لیست */
  async publicForProduct(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: "PUBLISHED" },
      select: { id: true, name: true },
    });
    if (!product) {
      return { found: false as const, summary: null, items: [] };
    }
    const rows = await this.prisma.review.findMany({
      where: { productId: product.id, status: "APPROVED" },
      orderBy: { createdAt: "desc" },
      take: PUBLIC_LIMIT,
      select: {
        id: true, name: true, rating: true, body: true,
        isVerifiedPurchase: true, adminReply: true, createdAt: true,
      },
    });
    // خلاصه روی «همهٔ» نظرات تأییدشده — نه فقط ۵۰ ردیف اخیر
    const agg = await this.prisma.review.aggregate({
      where: { productId: product.id, status: "APPROVED" },
      _count: { _all: true },
      _avg: { rating: true },
    });
    const distRows = await this.prisma.review.groupBy({
      by: ["rating"],
      where: { productId: product.id, status: "APPROVED" },
      _count: { _all: true },
    });
    const dist = [0, 0, 0, 0, 0];
    for (const g of distRows) dist[g.rating - 1] = g._count._all;
    const total = agg._count._all;
    return {
      found: true as const,
      productName: product.name,
      summary: {
        count: total,
        avg: agg._avg.rating != null ? Math.round(agg._avg.rating * 10) / 10 : null,
        stars: dist,
      },
      items: rows.map((r) => ({
        id: r.id,
        name: r.name?.trim() || "مهمان",
        rating: r.rating,
        body: r.body,
        isVerifiedPurchase: r.isVerifiedPurchase,
        adminReply: r.adminReply,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  // ------------------------------------------------------------- صف ادمین

  async queue(opts: { status?: string; page?: number }) {
    const status = (["PENDING", "APPROVED", "REJECTED", "HIDDEN"] as const).includes(opts.status as never)
      ? (opts.status as "PENDING" | "APPROVED" | "REJECTED" | "HIDDEN")
      : "PENDING";
    const page = Math.max(1, Number(opts.page ?? 1));
    const take = 20;
    const [items, counts] = await Promise.all([
      this.prisma.review.findMany({
        where: { status },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * take,
        take,
        select: {
          id: true, rating: true, body: true, status: true, name: true, mobile: true,
          isVerifiedPurchase: true, adminReply: true, createdAt: true,
          product: { select: { id: true, name: true, slug: true } },
        },
      }),
      this.prisma.review.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    const byStatus: Record<string, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0, HIDDEN: 0 };
    for (const g of counts) byStatus[g.status] = g._count._all;
    return { status, page, items, counts: byStatus };
  }

  /** تغییر وضعیت/پاسخ ادمین — هر اقدام AuditLog با قبل/بعد می‌گیرد */
  async moderate(
    id: string,
    action: "approve" | "reject" | "hide" | "reply",
    actorId: string | null,
    extra: { reply?: string } = {},
  ) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new BadRequestException({ code: "NOT_FOUND", message: "نظر یافت نشد." });

    const oldValues = { status: review.status, adminReply: review.adminReply };
    let data: { status?: "APPROVED" | "REJECTED" | "HIDDEN"; adminReply?: string | null };
    switch (action) {
      case "approve":
        data = { status: "APPROVED" };
        break;
      case "reject":
        data = { status: "REJECTED" };
        break;
      case "hide":
        data = { status: "HIDDEN" };
        break;
      case "reply": {
        const reply = String(extra.reply ?? "").trim();
        if (reply.length < 2 || reply.length > 1000) {
          throw new BadRequestException({ code: "VALIDATION_ERROR", message: "پاسخ بین ۲ تا ۱۰۰۰ حرف باشد." });
        }
        data = { adminReply: reply };
        break;
      }
    }

    const updated = await this.prisma.review.update({ where: { id }, data, select: { id: true, status: true, adminReply: true } });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: `review.${action}`,
        entity: "Review",
        entityId: id,
        oldValues: oldValues,
        newValues: { status: updated.status, adminReply: updated.adminReply },
      },
    });
    return updated;
  }
}
