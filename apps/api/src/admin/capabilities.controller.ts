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
import { CredentialsService } from "./credentials.service";
import { mediaDir, safeMediaPath } from "../common/media-dir";
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
// MEDIA_DIR از common/media-dir می‌آید تا آپلود، سرو و پایش هرگز مسیر متفاوت نداشته باشند.

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
    private readonly credentials: CredentialsService,
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
  async upload(@Body() body: { filename: string; mime: string; dataBase64: string; alt?: string; title?: string }) {
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
    fs.mkdirSync(mediaDir(), { recursive: true });
    const key = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${spec.ext}`;
    const safe = path.resolve(mediaDir(), key);
    if (!safe.startsWith(mediaDir())) throw new BadRequestException({ code: "PATH", message: "مسیر نامعتبر." });
    fs.writeFileSync(safe, buf);
    const dims = readImageSize(buf); // فاز ۱۴: ابعاد از محتوای واقعی فایل
    const media = await this.prisma.media.create({
      data: { kind: body.mime === "application/pdf" ? "doc" : "image", storageKey: key, mime: body.mime, sizeBytes: BigInt(buf.length), width: dims?.w ?? null, height: dims?.h ?? null, alt: body.alt ?? null, title: body.title ?? null },
    });
    return { id: media.id, url: `/api/media/${key}`, storageKey: key, alt: media.alt, title: media.title, key };
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
    const buf = readMediaFile(mediaDir(), m.storageKey);
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
    fs.mkdirSync(mediaDir(), { recursive: true });
    const newKey = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${spec.ext}`;
    const safeNew = path.resolve(mediaDir(), newKey);
    if (!safeNew.startsWith(mediaDir())) throw new BadRequestException({ code: "PATH", message: "مسیر نامعتبر." });
    fs.writeFileSync(safeNew, buf);
    const newDims = readImageSize(buf); // فاز ۱۴: ابعاد فایل جدید از محتوای واقعی
    const updated = await this.prisma.media.update({
      where: { id },
      data: { storageKey: newKey, mime: body.mime, kind: body.mime === "application/pdf" ? "doc" : "image", sizeBytes: BigInt(buf.length), width: newDims?.w ?? null, height: newDims?.h ?? null },
    });
    // حذف فایل قدیمی — بعد از موفقیت آپدیت (اگر وسطش crash شود فقط فایل یتیم می‌ماند، ردیف خراب نمی‌شود)
    const oldSafe = path.resolve(mediaDir(), m.storageKey);
    if (oldSafe.startsWith(mediaDir()) && m.storageKey !== newKey && fs.existsSync(oldSafe)) {
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
    const safe = safeMediaPath(m.storageKey);
    if (safe && fs.existsSync(safe)) fs.unlinkSync(safe);
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
  // صفحه‌ساز قدیمیِ HomeSection حذف شد؛ جای آن «صفحه‌ساز زنده»
  // (apps/api/src/cms — جدول CmsPage با انتشار، تاریخچه و پیش‌نمایش) است.

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
    // فقط همین ردیف — نه drain کل صف (retry هدف‌دار، بدون اثر جانبی روی بقیه)
    const r = await this.dispatcher.dispatchOne(id);
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
    return this.activateSmsProvider(String(body?.provider ?? "") as SmsProviderId, identity?.userId);
  }

  /** هستهٔ مشترک انتخاب اپراتور — از مسیر ذخیرهٔ کلید هم صدا زده می‌شود */
  private async activateSmsProvider(id: SmsProviderId, actorId?: string) {
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
        actorId: actorId ?? null,
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

  /**
   * ذخیرهٔ کلید API اپراتور پیامک — از کانال رسمی credentials (env/.env.local، هرگز DB)
   * به‌همراه انتخاب همان اپراتور به‌عنوان فعال (الگوی یک‌کارت: اپراتور → کلید → تست → ذخیره).
   */
  @Post("sms/providers/key")
  @RequirePermission("settings.manage")
  async saveSmsProviderKey(@Body() body: { provider?: string; key?: string }) {
    const id = String(body?.provider ?? "") as SmsProviderId;
    const meta = SMS_PROVIDERS.find((p) => p.id === id);
    if (!meta) {
      throw new BadRequestException({ code: "UNKNOWN_PROVIDER", message: "اپراتور پیامک نامعتبر است." });
    }
    const key = String(body?.key ?? "").trim();
    if (!key) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "کلید خالی است؛ برای پاک‌کردن از کارت کلیدها استفاده کنید." });
    }
    if (key.length > 512) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "کلید بیش از حد بلند است." });
    }
    // ملی‌پیامک قالب username:password دارد — ساختار را همین‌جا می‌سنجم تا خطا زودتر پیدا شود
    if (id === "melipayamak" && !key.includes(":")) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "کلید ملی‌پیامک باید به شکل username:password باشد." });
    }
    // ثبت در فایل env.local توسط کانال موجود (همین فرایند، همان محدودیت کلیدها)
    await this.credentials.save({ [meta.envKey]: key });
    // همان اپراتور فعال می‌شود — کارت واحد یعنی این انتخاب و کلیدش یکی‌اند
    await this.activateSmsProvider(id);
    return this.sms.providersStatus().filter((p) => p.id === id)[0] ?? { ok: true };
  }

  // ================== دستیار AI (تصمیم #۱۵ — گام ۱۸-۲) ==================

  /** وضعیت اتصال AI — سازگار OpenAI؛ credential از env/.env.local (بند ۴۵)، بدون فیک (بند ۱۱۱) */
  @Get("ai")
  @RequirePermission("settings.view")
  async aiStatus() {
    const items = this.credentials.status().items;
    const baseUrl = process.env.AI_BASE_URL ?? "";
    return {
      configured: Boolean(baseUrl && process.env.AI_API_KEY && process.env.AI_MODEL),
      baseUrl,
      model: process.env.AI_MODEL ?? "",
      key: items["AI_API_KEY"] ?? null,
    };
  }

  /** ذخیرهٔ تنظیمات AI (نشانی/کلید/مدل) — از همان گاوصندوق credential (هرگز DB) */
  @Post("ai/settings")
  @RequirePermission("settings.manage")
  async saveAiSettings(@Body() body: { baseUrl?: string; apiKey?: string; model?: string }) {
    const updates: Record<string, string> = {};
    const fields: Array<["AI_BASE_URL" | "AI_API_KEY" | "AI_MODEL", string | undefined]> = [
      ["AI_BASE_URL", body.baseUrl],
      ["AI_API_KEY", body.apiKey],
      ["AI_MODEL", body.model],
    ];
    for (const [key, value] of fields) {
      if (value === undefined) continue;
      const val = String(value).trim();
      if (val.length > 2048) {
        throw new BadRequestException({ code: "VALIDATION_ERROR", message: "مقدار بیش از حد بلند است." });
      }
      if (key === "AI_BASE_URL" && val && !/^https?:\/\//.test(val)) {
        throw new BadRequestException({ code: "VALIDATION_ERROR", message: "نشانی سرویس AI باید با http یا https شروع شود." });
      }
      updates[key] = val;
    }
    if (Object.keys(updates).length === 0) {
      throw new BadRequestException({ code: "EMPTY", message: "چیزی برای ذخیره ارسال نشده است." });
    }
    const saved = await this.credentials.save(updates);
    return { ...saved, status: await this.aiStatus() };
  }

  /** پیکربندی AI یا خطای صریح — بدون فیک، بند ۱۱۱ */
  private aiConfig() {
    const baseUrl = (process.env.AI_BASE_URL ?? "").replace(/\/+$/, "");
    const apiKey = process.env.AI_API_KEY ?? "";
    const model = process.env.AI_MODEL ?? "";
    if (!baseUrl || !apiKey || !model) {
      throw new BadRequestException({
        code: "REQUIRES_CREDENTIAL",
        message: "تنظیمات AI کامل نیست — نشانی، کلید و مدل را در کارت دستیار وارد کن.",
      });
    }
    return { baseUrl, apiKey, model };
  }

  /** فراخوانی chat completion سازگار OpenAI — تنها مسیر گفتگو با سرویس AI */
  private async aiChat(messages: Array<{ role: "system" | "user"; content: string }>, maxTokens: number) {
    const { baseUrl, apiKey, model } = this.aiConfig();
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(30_000),
    }).catch((e) => {
      throw new BadRequestException({ code: "AI_PROVIDER_ERROR", message: `اتصال به سرویس AI برقرار نشد: ${String(e)}` });
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new BadRequestException({ code: "AI_PROVIDER_ERROR", message: `پاسخ سرویس AI: ${res.status} — ${text.slice(0, 200)}` });
    }
    const json = (await res.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null;
    const content = (json?.choices?.[0]?.message?.content ?? "").trim();
    if (!content) {
      throw new BadRequestException({ code: "AI_EMPTY", message: "سرویس AI پاسخ خالی داد؛ مدل یا نشانی را بررسی کن." });
    }
    return content;
  }

  /** تست اتصال — یک فراخوانی واقعی و کوچک با همان کلید و مدل ذخیره‌شده */
  @Post("ai/test")
  @RequirePermission("settings.manage")
  async aiTest() {
    const reply = await this.aiChat([{ role: "user", content: "یک کلمه بنویس: سلام" }], 32);
    return { ok: true, reply: reply.slice(0, 120) };
  }

  /** پیشنهاد جایگزین برای متنِ خارج از چارچوب لحن — دستیار ممیزی لحن در پنل ادمین */
  @Post("ai/suggest")
  @RequirePermission("settings.view")
  async aiSuggest(@Body() body: { text?: string; rule?: string; detail?: string; formal?: boolean; file?: string }) {
    const text = String(body?.text ?? "").trim();
    if (!text || text.length > 600) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "متن برای پیشنهاد نامعتبر است." });
    }
    const rule = String(body?.rule ?? "R1").slice(0, 8);
    const detail = String(body?.detail ?? "").slice(0, 300);
    const file = String(body?.file ?? "").slice(0, 200);
    const formal = body?.formal === true;
    const system =
      "تو ویراستار متن‌های فارسی رابط کاربر فروشگاه اینترنتی قاصدک هستی. " +
      "متن کاربر را در چارچوب لحن زیر بازنویسی کن: " +
      "لحن پیش‌فرض صمیمی و دوم‌شخص مفرد است (تو) با نگارش معیار فارسی: «را» نه «رو»، «می‌توانی» نه «می‌تونی». " +
      "اگر لحن هدف رسمی بود، دوم‌شخص جمع (شما) با همان نگارش معیار. " +
      "«لطفاً» ممنوع است؛ گرمی از فعل کوتاه و بی‌تعارفه می‌آید. " +
      "به‌جای «کلیک»، فعلِ خودِ کار را نام ببر («انتخاب کن»، «بزن»). " +
      "پیام خطا همیشه راه‌حل می‌دهد؛ الگوی «چه شد؛ چه کار کن». " +
      "اصطلاح فنی و داخلی (توکن، nonce و مانند آن) در متن کاربر نمی‌آید؛ با زبان کاربر توصیفش کن. " +
      "معنا، اطلاعات و طول متن را تا جای ممکن حفظ کن؛ فقط لحن و نگارش اصلاح شود. " +
      "فقط و فقط متن جایگزین نهایی را بنویس: بدون توضیح، بدون مقدمه، بدون نقل‌قول، بدون Markdown.";
    const raw = await this.aiChat(
      [
        { role: "system", content: system },
        {
          role: "user",
          content:
            `فایل: ${file}\nقاعدهٔ نقض‌شده: ${rule} — ${detail}\n` +
            `لحن هدف: ${formal ? "رسمی (شما)" : "صمیمی (تو)"}\nمتن فعلی:\n${text}`,
        },
      ],
      400,
    );
    // مدل‌ها گاهی پاسخ را در fence یا نقل‌قول می‌پیچند — برای متنِ رابط کاربر فقط خودِ متن لازم است
    const suggestion = raw
      .replace(/```[a-z]*\n?/g, "")
      .replace(/```/g, "")
      .trim()
      .replace(/^["'«»]+/, "")
      .replace(/["'«»]+$/, "")
      .trim();
    return { suggestion };
  }

  /** چت‌بات مشتری — SSE streaming (گام ۱۸-۳) 
   * درخواست: { messages: [{ role: 'user' | 'assistant', content: string }], stream?: boolean }
   * پاسخ SSE: data: { chunk: string }\n\n (یا تمام متن اگر stream=false)
   * خطاها: REQUIRES_CREDENTIAL (بدون تنظیمات)، VALIDATION_ERROR (بدنه نامعتبر)
   */
  @Post("ai/chat")
  @RequirePermission("settings.view")
  async aiChatStream(@Body() body: { messages?: Array<{ role: "user" | "assistant"; content: string }>; stream?: boolean }, @Res() res: Response) {
    // اعتبارسنجی ورودی
    const messages = Array.isArray(body?.messages) ? body.messages.slice(-10) : []; // حداکثر ۱۰ پیام اخیر
    if (messages.length === 0 || messages.some((m) => !m?.content || typeof m.content !== "string" || m.content.length > 2000)) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "پیام‌ها نامعتبر هستند (خالی، بیش از ۲۰۰۰ کاراکتر، یا ساختار اشتباه)." });
    }
    // فقط user/assistant مجاز؛ system از سمت کلاینت ممنوع
    const filtered = messages.filter((m) => m.role === "user" || m.role === "assistant");
    if (filtered.length !== messages.length) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "فقط نقش user و assistant مجاز است." });
    }
    
    const { baseUrl, apiKey, model } = this.aiConfig();
    
    // System prompt برای چت‌بات فروشگاهی
    const systemPrompt = this.buildChatSystemPrompt();
    
    const payload = {
      model,
      messages: [{ role: "system", content: systemPrompt }, ...filtered],
      temperature: 0.3,
      max_tokens: 512,
      stream: body.stream === true,
    };
    
    if (!body.stream) {
      // حالت non-streaming برای تست/سازگاری
      const aiRes = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      }).catch((e) => {
        throw new BadRequestException({ code: "AI_PROVIDER_ERROR", message: `اتصال به سرویس AI برقرار نشد: ${String(e)}` });
      });
      if (!aiRes.ok) {
        const text = await aiRes.text().catch(() => "");
        throw new BadRequestException({ code: "AI_PROVIDER_ERROR", message: `پاسخ سرویس AI: ${aiRes.status} — ${text.slice(0, 200)}` });
      }
      const json = (await aiRes.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null;
      const content = (json?.choices?.[0]?.message?.content ?? "").trim();
      if (!content) {
        throw new BadRequestException({ code: "AI_EMPTY", message: "سرویس AI پاسخ خالی داد." });
      }
      return res.json({ content });
    }
    
    // Streaming response
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    
    const send = (data: object) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    
    try {
      const aiRes = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60_000),
      }).catch((e) => {
        throw new BadRequestException({ code: "AI_PROVIDER_ERROR", message: `اتصال به سرویس AI برقرار نشد: ${String(e)}` });
      });
      
      if (!aiRes.ok || !aiRes.body) {
        const text = await aiRes.text().catch(() => "");
        send({ error: `AI_PROVIDER_ERROR: ${aiRes.status} — ${text.slice(0, 200)}` });
        res.end();
        return;
      }
      
      const reader = aiRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") {
            send({ done: true });
            res.end();
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const chunk = parsed.choices?.[0]?.delta?.content;
            if (chunk) send({ chunk });
          } catch {
            // ignore parse errors on partial chunks
          }
        }
      }
      send({ done: true });
      res.end();
    } catch (e) {
      send({ error: `AI_PROVIDER_ERROR: ${String(e)}` });
      res.end();
    }
  }

  /** تولید system prompt برای چت‌بات با کانتکست کاتالوگ */
  private buildChatSystemPrompt(): string {
    return "تو دستیار خرید فروشگاه اینترنتی قاصدک هستی. " +
      "لحن صمیمی، کم‌کلام، و کاربردی (دوم‌شخص مفرد «تو»). " +
      "قوانین: (۱) فقط درباره محصولات، سفارش، ارسال، مرجوعی، سایز، و راهنمای خرید پاسخ بده. " +
      "(۲) اگر جواب قطعی نداری، به‌جای حدس بگو «مطمئن نیستم، می‌توانم در مورد … کمکتان کنم» و به بخش مربوطه راهنمایی کن. " +
      "(۳) قیمت/موجودی دقیق فقط از API بگیر؛ اگر دادهٔ زنده نداری بگو «موجودی لحظه‌ای را در صفحه محصول ببینید». " +
      "(۴) هیچ‌گاه اطلاعات حساس (رمز، کد پیگیری، توکن) نپرس و نده. " +
      "(۵) پاسخ‌ها کوتاه، ساختاریافته، و قابل‌اسکن باشند؛ از لیست تک‌نقطه استفاده کن. " +
      "(۶) برای موضوعات خارج از چارچوب (سیاست، اخبار، شرکتی) بگو «این موضوع در حوزه کمک من نیست» و به بخش مرتبط ارجاع بده.";
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
