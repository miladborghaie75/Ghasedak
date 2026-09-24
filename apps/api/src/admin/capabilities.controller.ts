import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { RequirePermission } from "../auth/permissions.guard";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

/**
 * قابلیت‌های مدیریت‌شده در داشبورد — SMS/درگاه پرداخت/CRM/ارسال/مالیات/مدیا/کوپن/فروش.
 * اصل بند ۱۱۱: credential از env؛ اینجا فقط «وضعیت واقعی» نمایش داده می‌شود
 * (بدون فیک) و تنظیمات غیر-محرمانه (مثل شماره فرستنده یا فعال/غیرفعال) در Setting ذخیره می‌شود.
 */

// ---------- MIME/extension validation برای Media (بند ۳۵/۱۱۰) ----------
const ALLOWED = new Map<string, { ext: string; magic: number[] }>([
  ["image/jpeg", { ext: ".jpg", magic: [0xff, 0xd8, 0xff] }],
  ["image/png", { ext: ".png", magic: [0x89, 0x50, 0x4e, 0x47] }],
  ["image/webp", { ext: ".webp", magic: [0x52, 0x49, 0x46, 0x46] }],
  ["application/pdf", { ext: ".pdf", magic: [0x25, 0x50, 0x44, 0x46] }],
]);
const MAX_UPLOAD = 10 * 1024 * 1024; // 10MB
const MEDIA_DIR = process.env.MEDIA_DIR ?? path.resolve(process.cwd(), "../data/media");

@Controller("admin/capabilities")
export class CapabilitiesController {
  constructor(private readonly prisma: PrismaService) {}

  // ================== مجوزهای کاربر جاری (برای UI شرطی) ==================
  @Get("me/permissions")
  @RequirePermission("dashboard.view")
  async myPermissions(@Req() req: Request) {
    const identity = (req as unknown as Record<string, unknown>).adminIdentity as { userId: string } | undefined;
    const user = identity?.userId
      ? await this.prisma.user.findUnique({ where: { id: identity.userId }, select: { role: true } })
      : null;
    const perms = user
      ? await this.prisma.rolePermission.findMany({ where: { role: user.role } })
      : [];
    return { permissions: perms.map((p) => p.permissionKey) };
  }

  // ================== وضعیت قابلیت‌ها (بدون فیک — بند ۱۱۱) ==================
  @Get("status")
  @RequirePermission("settings.view")
  async status() {
    const zarinpalConfigured = !!process.env.ZARINPAL_MERCHANT_ID;
    const kavenegarConfigured = !!process.env.KAVENEGAR_API_KEY;
    const smsSetting = await this.prisma.setting.findUnique({ where: { key: "sms" } });
    const paymentSetting = await this.prisma.setting.findUnique({ where: { key: "payment" } });
    const shippingSetting = await this.prisma.setting.findUnique({ where: { key: "shipping" } });
    const taxSetting = await this.prisma.setting.findUnique({ where: { key: "tax" } });
    const crmSetting = await this.prisma.setting.findUnique({ where: { key: "crm" } });
    const motionSetting = await this.prisma.setting.findUnique({ where: { key: "motion" } });
    return {
      sms: {
        provider: "kavenegar",
        credential: kavenegarConfigured ? "CONFIGURED" : "REQUIRES_CREDENTIAL",
        config: smsSetting?.value ?? { sender: "", orderNotify: true, marketing: false },
      },
      payment: {
        zarinpal: zarinpalConfigured ? "CONFIGURED" : "REQUIRES_CREDENTIAL",
        mock: process.env.NODE_ENV !== "production" ? "ACTIVE_DEV_ONLY" : "DISABLED",
        config: paymentSetting?.value ?? {},
      },
      crm: { config: crmSetting?.value ?? { abandonedCartHours: 24, followUpDays: 7, consentRequired: true } },
      shipping: { config: shippingSetting?.value ?? { defaultCarrier: "post", freeOver: 0 } },
      tax: { config: taxSetting?.value ?? { rate: 0, enabled: false, moadianClaim: false } },
      motion: { config: motionSetting?.value ?? { enabled: true, intensity: "subtle" } },
    };
  }

  /** ذخیره تنظیمات یک قابلیت — مقادیر غیر-محرمانه فقط */
  @Post("settings/:key")
  @RequirePermission("settings.manage")
  async saveCapability(@Param("key") key: string, @Body() body: { value: unknown }) {
    const allowed = ["sms", "payment", "shipping", "tax", "crm", "motion"];
    if (!allowed.includes(key)) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "کلید نامعتبر است." });
    }
    if (typeof body.value !== "object" || body.value == null) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "مقدار باید object باشد." });
    }
    // مقادیر محرمانه هرگز از بدنه پذیرفته نمی‌شود (بند ۴۵)
    const v = JSON.parse(JSON.stringify(body.value)) as Record<string, unknown>;
    for (const secret of ["apiKey", "merchantId", "password", "token"]) delete v[secret];
    await this.prisma.setting.upsert({
      where: { key },
      update: { value: v as object },
      create: { key, value: v as object },
    });
    return { ok: true };
  }

  /** تست ارسال SMS — فقط وقتی credential واقعی موجود است؛ وگرنه خطای صریح (بدون فیک) */
  @Post("sms/test")
  @RequirePermission("settings.manage")
  async smsTest(@Body() body: { mobile: string }) {
    if (!/^09\d{9}$/.test(body.mobile ?? "")) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "موبایل ۱۱ رقم با ۰۹." });
    }
    if (!process.env.KAVENEGAR_API_KEY) {
      throw new BadRequestException({
        code: "REQUIRES_CREDENTIAL",
        message: "KAVENEGAR_API_KEY تنظیم نشده — ارسال واقعی ممکن نیست. (بند ۱۱۱)",
      });
    }
    // ارسال واقعی با Kavenegar REST (بدون SDK) — برگشت وضعیت واقعی
    const apiKey = process.env.KAVENEGAR_API_KEY;
    const sender = (await this.prisma.setting.findUnique({ where: { key: "sms" } }))?.value as { sender?: string } | null;
    const url = `https://api.kavenegar.com/v1/${apiKey}/sms/send.json?receptor=${encodeURIComponent(body.mobile)}&message=${encodeURIComponent("پیام آزمایشی قاصدک")}${sender?.sender ? `&sender=${encodeURIComponent(sender.sender)}` : ""}`;
    const res = await fetch(url, { method: "GET" }).catch((e) => {
      throw new BadRequestException({ code: "SMS_PROVIDER_ERROR", message: `خطای provider: ${String(e)}` });
    });
    const json = (await res.json().catch(() => null)) as { return?: { status?: number; message?: string } } | null;
    return { ok: res.ok && json?.return?.status === 200, provider: json?.return ?? null };
  }

  // ================== Media Library (بند ۳۵) ==================
  @Post("media")
  @RequirePermission("media.manage")
  async upload(@Body() body: { filename: string; mime: string; dataBase64: string; alt?: string }) {
    if (!body.dataBase64 || !body.mime || !ALLOWED.has(body.mime)) {
      throw new BadRequestException({ code: "MEDIA_TYPE", message: "فرمت مجاز: jpg/png/webp/pdf" });
    }
    const buf = Buffer.from(body.dataBase64, "base64");
    if (buf.length === 0 || buf.length > MAX_UPLOAD) {
      throw new BadRequestException({ code: "MEDIA_SIZE", message: "حجم فایل حداکثر ۱۰ مگابایت." });
    }
    const spec = ALLOWED.get(body.mime)!;
    // magic-byte — بند ۱۱۰: محتوای جعلی با پسوند درست رد می‌شود
    for (let i = 0; i < spec.magic.length; i++) {
      if (buf[i] !== spec.magic[i]) {
        throw new BadRequestException({ code: "MEDIA_MAGIC", message: "محتوای فایل با فرمت اعلام‌شده هم‌خوان نیست." });
      }
    }
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const key = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${spec.ext}`;
    const safe = path.resolve(MEDIA_DIR, key);
    if (!safe.startsWith(MEDIA_DIR)) throw new BadRequestException({ code: "PATH", message: "مسیر نامعتبر." });
    fs.writeFileSync(safe, buf);
    const media = await this.prisma.media.create({
      data: { kind: body.mime === "application/pdf" ? "doc" : "image", storageKey: key, mime: body.mime, sizeBytes: BigInt(buf.length), alt: body.alt ?? null },
    });
    return { id: media.id, url: `/api/media/${key}`, key };
  }

  @Get("media")
  @RequirePermission("media.view")
  async listMedia() {
    const items = await this.prisma.media.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    return { items: items.map((m) => ({ ...m, url: `/api/media/${m.storageKey}` })) };
  }

  @Delete("media/:id")
  @RequirePermission("media.manage")
  async deleteMedia(@Param("id") id: string) {
    const m = await this.prisma.media.findUnique({ where: { id } });
    if (!m) return { ok: true };
    // جلوگیری از حذف استفاده‌شده — رفرنس‌ها چک می‌شوند
    const [inProducts, inBrands, inCategories] = await Promise.all([
      this.prisma.productImage.count({ where: { mediaId: id } }),
      this.prisma.brand.count({ where: { logoId: id } }),
      this.prisma.category.count({ where: { imageId: id } }),
    ]);
    if (inProducts + inBrands + inCategories > 0) {
      throw new BadRequestException({ code: "MEDIA_IN_USE", message: "فایل در حال استفاده است." });
    }
    const safe = path.resolve(MEDIA_DIR, m.storageKey);
    if (safe.startsWith(MEDIA_DIR) && fs.existsSync(safe)) fs.unlinkSync(safe);
    await this.prisma.media.delete({ where: { id } });
    return { ok: true };
  }

  // ================== کوپن (بند ۳۹) ==================
  @Get("coupons")
  @RequirePermission("marketing.view")
  async coupons() {
    const items = await this.prisma.coupon.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { redemptions: true } } },
    });
    return { items };
  }

  @Post("coupons")
  @RequirePermission("marketing.manage")
  async createCoupon(@Body() body: {
    code: string; type: "percent" | "fixed"; amount: number;
    startsAt?: string | null; endsAt?: string | null;
    usageLimit?: number | null; perCustomerLimit?: number | null;
    minCartTotal?: number | null; maxDiscount?: number | null; active?: boolean;
  }) {
    const code = body.code?.trim().toUpperCase();
    if (!code || code.length < 3) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "کد حداقل ۳ حرف." });
    if (await this.prisma.coupon.findUnique({ where: { code } })) {
      throw new BadRequestException({ code: "DUPLICATE", message: "این کد قبلاً ثبت شده است." });
    }
    if (!Number.isSafeInteger(body.amount) || body.amount <= 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "مقدار تخفیف نامعتبر است." });
    }
    if (body.type === "percent" && body.amount > 100) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "درصد حداکثر ۱۰۰." });
    }
    return this.prisma.coupon.create({
      data: {
        code,
        type: body.type,
        amount: BigInt(body.amount),
        startsAt: body.startsAt ? new Date(body.startsAt) : null,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
        usageLimit: body.usageLimit ?? null,
        perCustomerLimit: body.perCustomerLimit ?? null,
        minCartTotal: body.minCartTotal != null ? BigInt(body.minCartTotal) : null,
        maxDiscount: body.maxDiscount != null ? BigInt(body.maxDiscount) : null,
        active: body.active ?? true,
      },
    });
  }

  @Post("coupons/:id/toggle")
  @RequirePermission("marketing.manage")
  async toggleCoupon(@Param("id") id: string) {
    const c = await this.prisma.coupon.findUnique({ where: { id } });
    if (!c) throw new BadRequestException({ code: "NOT_FOUND", message: "کوپن یافت نشد." });
    return this.prisma.coupon.update({ where: { id }, data: { active: !c.active } });
  }

  @Delete("coupons/:id")
  @RequirePermission("marketing.manage")
  async deleteCoupon(@Param("id") id: string) {
    const used = await this.prisma.couponRedemption.count({ where: { couponId: id } });
    if (used > 0) {
      throw new BadRequestException({ code: "IN_USE", message: `کوپن ${used} بار استفاده شده — فقط غیرفعال شود.` });
    }
    await this.prisma.coupon.delete({ where: { id } });
    return { ok: true };
  }

  @Get("coupons/:id/redemptions")
  @RequirePermission("marketing.view")
  async couponRedemptions(@Param("id") id: string, @Query() q: { page?: string }) {
    const page = Math.max(1, Number(q.page ?? 1));
    const [items, total] = await Promise.all([
      this.prisma.couponRedemption.findMany({
        where: { couponId: id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * 30,
        take: 30,
        include: { order: { select: { code: true, total: true } } },
      }),
      this.prisma.couponRedemption.count({ where: { couponId: id } }),
    ]);
    return { items, total, page };
  }

  // ================== گزارش فروش (بند ۳۱) ==================
  @Get("sales-report")
  @RequirePermission("reports.view")
  async salesReport(@Query() q: { days?: string }) {
    const days = Math.min(90, Math.max(7, Number(q.days ?? 30)));
    const since = new Date(Date.now() - days * 24 * 3600_000);
    // سفارش‌های پرداخت‌شده آنلاین + فاکتور POS نهایی
    const orders = await this.prisma.order.groupBy({
      by: ["paymentStatus"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { total: true },
    });
    const pos = await this.prisma.posInvoice.aggregate({
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { grandTotal: true },
    });
    const daily = await this.prisma.$queryRaw<Array<{ d: Date; total: bigint; n: bigint }>>`
      SELECT date_trunc('day', "createdAt") AS d, SUM("total") AS total, COUNT(*) AS n
      FROM "Order" WHERE "createdAt" >= ${since} AND "paymentStatus" = 'PAID'
      GROUP BY 1 ORDER BY 1`;
    const dailyPos = await this.prisma.$queryRaw<Array<{ d: Date; total: bigint; n: bigint }>>`
      SELECT date_trunc('day', "createdAt") AS d, SUM("grandTotal") AS total, COUNT(*) AS n
      FROM "PosInvoice" WHERE "createdAt" >= ${since}
      GROUP BY 1 ORDER BY 1`;
    const map = new Map<string, { date: string; online: number; pos: number; orders: number }>();
    for (const r of daily) {
      const k = new Date(r.d).toISOString().slice(0, 10);
      map.set(k, { date: k, online: Number(r.total), pos: 0, orders: Number(r.n) });
    }
    for (const r of dailyPos) {
      const k = new Date(r.d).toISOString().slice(0, 10);
      const prev = map.get(k) ?? { date: k, online: 0, pos: 0, orders: 0 };
      prev.pos = Number(r.total);
      map.set(k, prev);
    }
    const paidOnline = orders.find((o) => o.paymentStatus === "PAID");
    return {
      days,
      onlinePaid: { count: paidOnline?._count._all ?? 0, total: String(paidOnline?._sum.total ?? 0n) },
      pos: { count: pos._count._all, total: String(pos._sum.grandTotal ?? 0n) },
      daily: [...map.values()].sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  // ================== صفحه‌ساز — HomeSection (بند ۱۱۷) ==================
  @Get("home-sections")
  @RequirePermission("marketing.view")
  async homeSections() {
    const items = await this.prisma.homeSection.findMany({ orderBy: { sortOrder: "asc" } });
    return { items };
  }

  @Post("home-sections")
  @RequirePermission("marketing.manage")
  async createSection(@Body() body: { type: string; config: unknown; sortOrder?: number; enabled?: boolean }) {
    const allowed = ["HERO", "PRODUCT_CAROUSEL", "PRODUCT_GRID", "CATEGORY_GRID", "BRAND_GRID", "BANNER", "GUIDE_CARDS", "TRUST_CARDS", "NEED_FINDER", "RICH_TEXT", "NEWSLETTER", "IMAGE_TEXT"];
    if (!allowed.includes(body.type)) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "نوع سکشن نامعتبر است." });
    }
    if (typeof body.config !== "object" || body.config == null) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "config الزامی است." });
    }
    return this.prisma.homeSection.create({
      data: { type: body.type as never, config: body.config as object, sortOrder: body.sortOrder ?? 0, enabled: body.enabled ?? true },
    });
  }

  @Post("home-sections/:id")
  @RequirePermission("marketing.manage")
  async updateSection(
    @Param("id") id: string,
    @Body() body: { config?: unknown; sortOrder?: number; enabled?: boolean; publishStatus?: "DRAFT" | "PUBLISHED" },
  ) {
    const data: Record<string, unknown> = {};
    if (body.config !== undefined) data.config = body.config;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.publishStatus !== undefined) data.publishStatus = body.publishStatus;
    return this.prisma.homeSection.update({ where: { id }, data });
  }

  @Delete("home-sections/:id")
  @RequirePermission("marketing.manage")
  async deleteSection(@Param("id") id: string) {
    await this.prisma.homeSection.delete({ where: { id } });
    return { ok: true };
  }
}
