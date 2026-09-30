import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { RequirePermission } from "../auth/permissions.guard";
import { NotificationDispatcherService } from "../events/notification-dispatcher.service";
import { SMS_PROVIDERS, SmsProvidersService, SmsProviderId } from "../events/sms-providers.service";
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

/**
 * خواندن ابعاد تصویر از خود بایت‌ها (بدون وابستگی خارجی) — فاز ۱۴ شکاف رسانه.
 * PNG: IHDR در آفست ۱۶ (۴ بایت عرض + ۴ بایت ارتفاع big-endian).
 * JPEG: پیمایش segmentها تا marker SOF0..SOF3/SOFn (بدون DHT/DNR) و خواندن ارتفاع/عرض.
 */
export function readImageSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) { off++; continue; }
      const marker = buf[off + 1];
      // filler 0xff یا standalone markerها — جلو برو
      if (marker === 0xff || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) { off += 2; continue; }
      const len = buf.readUInt16BE(off + 2);
      // SOF0..SOF15 به‌جز DHT(0xc4)/JPG(0xc8)/DAC(0xcc) — همه ابعاد دارند
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (off + 9 <= buf.length) return { h: buf.readUInt16BE(off + 5), w: buf.readUInt16BE(off + 7) };
        return null;
      }
      off += 2 + len;
    }
  }
  return null;
}

/** فایل دیسک را برای ردیف Media امن می‌خواند (بدون path traversal) یا null */
export function readMediaFile(dir: string, storageKey: string): Buffer | null {
  if (!/^[a-zA-Z0-9._-]+$/.test(storageKey) || storageKey.includes("..")) return null;
  const safe = path.resolve(dir, storageKey);
  if (!safe.startsWith(dir)) return null;
  try {
    return fs.readFileSync(safe);
  } catch {
    return null;
  }
}

@Controller("admin/capabilities")
export class CapabilitiesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: NotificationDispatcherService,
    private readonly sms: SmsProvidersService,
  ) {}

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
    const dims = readImageSize(buf); // فاز ۱۴: ابعاد از محتوای واقعی فایل
    const media = await this.prisma.media.create({
      data: { kind: body.mime === "application/pdf" ? "doc" : "image", storageKey: key, mime: body.mime, sizeBytes: BigInt(buf.length), width: dims?.w ?? null, height: dims?.h ?? null, alt: body.alt ?? null },
    });
    return { id: media.id, url: `/api/media/${key}`, key };
  }

  @Get("media")
  @RequirePermission("media.view")
  async listMedia() {
    const items = await this.prisma.media.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    // sizeBytes از نوع BigInt است — قبل از JSON.stringify به number تبدیل می‌شود
    return {
      items: items.map((m) => ({
        id: m.id, kind: m.kind, storageKey: m.storageKey, mime: m.mime,
        sizeBytes: Number(m.sizeBytes), width: m.width, height: m.height,
        alt: m.alt, title: m.title, caption: m.caption, createdAt: m.createdAt,
        url: `/api/media/${m.storageKey}`,
      })),
    };
  }

  /** فاز ۱۲ — جزئیات کامل یک فایل رسانه‌ای + رفرنس‌های استفاده */
  @Get("media/:id")
  @RequirePermission("media.view")
  async mediaDetail(@Param("id") id: string) {
    const m = await this.prisma.media.findUnique({ where: { id } });
    if (!m) throw new BadRequestException({ code: "NOT_FOUND", message: "فایل یافت نشد." });
    const [inProducts, inBrands, inCategories] = await Promise.all([
      this.prisma.productImage.count({ where: { mediaId: id } }),
      this.prisma.brand.count({ where: { logoId: id } }),
      this.prisma.category.count({ where: { imageId: id } }),
    ]);
    return {
      id: m.id, kind: m.kind, storageKey: m.storageKey, mime: m.mime,
      sizeBytes: Number(m.sizeBytes), width: m.width, height: m.height,
      alt: m.alt, title: m.title, caption: m.caption, createdAt: m.createdAt,
      url: `/api/media/${m.storageKey}`,
      usage: { products: inProducts, brands: inBrands, categories: inCategories, total: inProducts + inBrands + inCategories },
    };
  }

  /** فاز ۱۲ — ویرایش متادیتا (alt/عنوان/توضیحات) */
  @Patch("media/:id")
  @RequirePermission("media.manage")
  async mediaUpdate(@Param("id") id: string, @Body() body: { alt?: string; title?: string; caption?: string }) {
    const m = await this.prisma.media.findUnique({ where: { id } });
    if (!m) throw new BadRequestException({ code: "NOT_FOUND", message: "فایل یافت نشد." });
    const data: { alt?: string | null; title?: string | null; caption?: string | null } = {};
    for (const k of ["alt", "title", "caption"] as const) {
      if (body[k] !== undefined) data[k] = String(body[k] ?? "").slice(0, 500) || null;
    }
    const updated = await this.prisma.media.update({ where: { id }, data });
    return { id: updated.id, alt: updated.alt, title: updated.title, caption: updated.caption, ok: true };
  }

  /** فاز ۱۴ شکاف رسانه — دانلود مستقیم: همان بایت‌ها با Content-Disposition: attachment */
  @Get("media/:id/download")
  @RequirePermission("media.view")
  async mediaDownload(@Param("id") id: string, @Res() res: Response) {
    const m = await this.prisma.media.findUnique({ where: { id } });
    if (!m) throw new BadRequestException({ code: "NOT_FOUND", message: "فایل یافت نشد." });
    const buf = readMediaFile(MEDIA_DIR, m.storageKey);
    if (!buf) throw new BadRequestException({ code: "FILE_MISSING", message: "فایل روی دیسک یافت نشد." });
    res.setHeader("content-type", m.mime);
    res.setHeader("content-length", String(buf.length));
    res.setHeader("content-disposition", `attachment; filename="${m.storageKey}"`);
    res.setHeader("cache-control", "no-store");
    res.send(buf);
  }

  /** فاز ۱۴ شکاف رسانه — لینک عمومی کامل (برای کپی/اشتراک در بیرون از پنل) */
  @Get("media/:id/link")
  @RequirePermission("media.view")
  async mediaLink(@Param("id") id: string, @Req() req: Request) {
    const m = await this.prisma.media.findUnique({ where: { id } });
    if (!m) throw new BadRequestException({ code: "NOT_FOUND", message: "فایل یافت نشد." });
    const proto = String(req.headers["x-forwarded-proto"] ?? req.protocol ?? "http").split(",")[0].trim();
    const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost:4000").split(",")[0].trim();
    const url = `/api/media/${m.storageKey}`;
    return { id: m.id, url, absolute: `${proto}://${host}${url}` };
  }

  /** فاز ۱۲ — جایگزینی فایل: فایل جدید با key جدید (immutable) و ردیف همان id به‌روز می‌شود؛
   *  فایل قبلی بعد از موفقیت حذف می‌شود (هیچ لینک دائمی به key قبلی لازم نیست — UI همیشه url فعلی ردیف را می‌گیرد). */
  @Post("media/:id/replace")
  @RequirePermission("media.manage")
  async mediaReplace(@Param("id") id: string, @Body() body: { filename: string; mime: string; dataBase64: string }) {
    const m = await this.prisma.media.findUnique({ where: { id } });
    if (!m) throw new BadRequestException({ code: "NOT_FOUND", message: "فایل یافت نشد." });
    if (!body.dataBase64 || !body.mime || !ALLOWED.has(body.mime)) {
      throw new BadRequestException({ code: "MEDIA_TYPE", message: "فرمت مجاز: jpg/png/webp/pdf" });
    }
    const buf = Buffer.from(body.dataBase64, "base64");
    if (buf.length === 0 || buf.length > MAX_UPLOAD) {
      throw new BadRequestException({ code: "MEDIA_SIZE", message: "حجم فایل حداکثر ۱۰ مگابایت." });
    }
    const spec = ALLOWED.get(body.mime)!;
    for (let i = 0; i < spec.magic.length; i++) {
      if (buf[i] !== spec.magic[i]) {
        throw new BadRequestException({ code: "MEDIA_MAGIC", message: "محتوای فایل با فرمت اعلام‌شده هم‌خوان نیست." });
      }
    }
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const newKey = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${spec.ext}`;
    const safeNew = path.resolve(MEDIA_DIR, newKey);
    if (!safeNew.startsWith(MEDIA_DIR)) throw new BadRequestException({ code: "PATH", message: "مسیر نامعتبر." });
    fs.writeFileSync(safeNew, buf);
    const newDims = readImageSize(buf); // فاز ۱۴: ابعاد فایل جدید از محتوای واقعی
    const updated = await this.prisma.media.update({
      where: { id },
      data: { storageKey: newKey, mime: body.mime, kind: body.mime === "application/pdf" ? "doc" : "image", sizeBytes: BigInt(buf.length), width: newDims?.w ?? null, height: newDims?.h ?? null },
    });
    // حذف فایل قدیمی — بعد از موفقیت آپدیت (اگر وسطش crash شود فقط فایل یتیم می‌ماند، ردیف خراب نمی‌شود)
    const oldSafe = path.resolve(MEDIA_DIR, m.storageKey);
    if (oldSafe.startsWith(MEDIA_DIR) && m.storageKey !== newKey && fs.existsSync(oldSafe)) {
      try { fs.unlinkSync(oldSafe); } catch { /* فایل قبلی مهم نیست */ }
    }
    return { id: updated.id, url: `/api/media/${newKey}`, key: newKey, ok: true };
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

  // ================== فاز ۱۱ (P2-B) — Notifications workspace ==================

  /** وضعیت صف نوتیفیکیشن‌ها — Pending/Sent/Failed/NotConfigured */
  @Get("notifications")
  @RequirePermission("settings.view")
  async notificationsList(@Query("status") status?: string) {
    const where = status && ["QUEUED", "SENT", "FAILED"].includes(status)
      ? { status: status as never }
      : { channel: { in: ["SMS", "EMAIL"] as never[] } };
    const items = await this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, channel: true, templateKey: true, to: true, status: true, lastError: true, attempts: true, sentAt: true, createdAt: true },
    });
    const [queued, sent, failed, notConfigured] = await Promise.all([
      this.prisma.notification.count({ where: { status: "QUEUED", channel: { in: ["SMS", "EMAIL"] } } }),
      this.prisma.notification.count({ where: { status: "SENT" } }),
      this.prisma.notification.count({ where: { status: "FAILED" } }),
      this.prisma.notification.count({ where: { status: "QUEUED", lastError: { startsWith: "NOT_CONFIGURED" } } }),
    ]);
    return { items, summary: { queued, sent, failed, notConfigured } };
  }

  /** retry آگاهانهٔ ادمین — FAILED → QUEUED و dispatch فوری */
  @Post("notifications/:id/retry")
  @RequirePermission("settings.manage")
  async notificationRetry(@Param("id") id: string) {
    const n = await this.prisma.notification.findUnique({ where: { id } });
    if (!n) throw new BadRequestException({ code: "NOT_FOUND", message: "نوتیفیکیشن یافت نشد." });
    if (n.status !== "FAILED") {
      throw new BadRequestException({ code: "NOT_RETRYABLE", message: "فقط ردیف FAILED قابل retry است." });
    }
    await this.prisma.notification.update({ where: { id }, data: { status: "QUEUED", lastError: null } });
    const r = await this.dispatcher.dispatchOnce(50);
    const after = await this.prisma.notification.findUniqueOrThrow({ where: { id } });
    return { ok: after.status === "SENT", status: after.status, lastError: after.lastError, dispatch: r };
  }

  /** dispatch دستی فوری (مثلاً بعد از تنظیم credential) */
  @Post("notifications/dispatch")
  @RequirePermission("settings.manage")
  async notificationDispatch() {
    return this.dispatcher.dispatchOnce(100);
  }

  // ================== چند-اپراتور پیامک (بند ۱۶) ==================

  /** فهرست اپراتورهای پیامک + اپراتور فعال + وضعیت کلید هرکدام (ماسک‌شده) */
  @Get("sms/providers")
  @RequirePermission("settings.view")
  async listSmsProviders() {
    const active = await this.sms.activeProviderId();
    return { providers: this.sms.providersStatus(), active };
  }

  /** انتخاب اپراتور فعال — ذخیره در Setting key="sms" (field provider) با audit */
  @Post("sms/providers/active")
  @RequirePermission("settings.manage")
  async setActiveSmsProvider(@Req() req: Request, @Body() body: { provider?: string }) {
    const identity = (req as unknown as Record<string, unknown>).adminIdentity as { userId?: string } | undefined;
    const id = String(body?.provider ?? "") as SmsProviderId;
    const meta = SMS_PROVIDERS.find((p) => p.id === id);
    if (!meta) {
      throw new BadRequestException({ code: "UNKNOWN_PROVIDER", message: "اپراتور پیامک نامعتبر است." });
    }
    const s = await this.prisma.setting.findUnique({ where: { key: "sms" } });
    const cfg = { ...((s?.value ?? {}) as Record<string, unknown>), provider: id };
    await this.prisma.setting.upsert({
      where: { key: "sms" },
      update: { value: cfg },
      create: { key: "sms", value: cfg },
    });
    await this.prisma.auditLog.create({
      data: {
        action: "sms.provider.set",
        entity: "Setting:sms",
        entityId: id,
        oldValues: s ? { provider: ((s.value ?? {}) as { provider?: string }).provider ?? "kavenegar" } : undefined,
        newValues: { provider: id },
        actorId: identity?.userId ?? null,
      },
    }).catch(() => undefined);
    return { ok: true, active: id, name: meta.name };
  }

  /** تست اتصال اپراتور — ارسال واقعی پیام آزمایشی به شمارهٔ داده‌شده */
  @Post("sms/providers/test")
  @RequirePermission("settings.manage")
  async testSmsProvider(@Body() body: { provider?: string; mobile?: string }) {
    if (!/^09\d{9}$/.test(body?.mobile ?? "")) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "موبایل ۱۱ رقم با ۰۹." });
    }
    const id = String(body?.provider ?? "") as SmsProviderId;
    if (!SMS_PROVIDERS.some((p) => p.id === id)) {
      throw new BadRequestException({ code: "UNKNOWN_PROVIDER", message: "اپراتور پیامک نامعتبر است." });
    }
    return this.sms.testConnection(id, String(body.mobile));
  }

  // ================== فاز ۱۲ (گام ۴) — Outbox workspace ==================

  /** خلاصهٔ outbox + ردیف‌ها — PENDING/FAILED مانیتورینگ، DISPATCHED اختیاری */
  @Get("outbox")
  @RequirePermission("settings.view")
  async outboxList(@Query("state") state?: string, @Query("includeDispatched") includeDispatched?: string) {
    const base = state && ["PENDING", "DISPATCHED", "FAILED"].includes(state)
      ? { state: state as never }
      : includeDispatched === "1" ? {} : { state: { not: "DISPATCHED" as never } };
    const items = await this.prisma.domainEventOutbox.findMany({
      where: base,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, name: true, state: true, attempts: true, lastError: true, availableAt: true, processedAt: true, createdAt: true },
    });
    const [pending, failed, dispatched] = await Promise.all([
      this.prisma.domainEventOutbox.count({ where: { state: "PENDING" } }),
      this.prisma.domainEventOutbox.count({ where: { state: "FAILED" } }),
      this.prisma.domainEventOutbox.count({ where: { state: "DISPATCHED" } }),
    ]);
    return { items, summary: { pending, failed, dispatched } };
  }

  /** retention: حذف DISPATCHEDهای قدیمی‌تر از N روز (پیش‌فرض 30) — FAILEDها هرگز خودکار حذف نمی‌شوند */
  @Post("outbox/prune")
  @RequirePermission("settings.manage")
  async outboxPrune(@Body() body: { olderThanDays?: number }) {
    const days = Math.max(1, Math.min(365, Number(body?.olderThanDays ?? 30)));
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const deleted = await this.prisma.domainEventOutbox.deleteMany({
      where: { state: "DISPATCHED", processedAt: { lt: cutoff } },
    });
    return { deleted: deleted.count, cutoff: cutoff.toISOString(), olderThanDays: days };
  }

  /** retry رویداد FAILED — PENDING می‌شود تا drain بعدی مصرفش کند */
  @Post("outbox/:id/retry")
  @RequirePermission("settings.manage")
  async outboxRetry(@Param("id") id: string) {
    const ev = await this.prisma.domainEventOutbox.findUnique({ where: { id } });
    if (!ev) throw new BadRequestException({ code: "NOT_FOUND", message: "رویداد یافت نشد." });
    if (ev.state !== "FAILED") {
      throw new BadRequestException({ code: "NOT_RETRYABLE", message: "فقط رویداد FAILED قابل retry است." });
    }
    const updated = await this.prisma.domainEventOutbox.update({
      where: { id },
      data: { state: "PENDING", availableAt: new Date(), lastError: null },
    });
    return { id: updated.id, state: updated.state };
  }
}
