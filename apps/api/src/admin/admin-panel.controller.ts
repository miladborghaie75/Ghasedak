import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { RequirePermission } from "../auth/permissions.guard";
import { InventoryService } from "../inventory/inventory.service";
import { InventorySettingsService } from "../inventory/inventory-settings.service";
import { JournalService } from "../accounting/journal.service";
import { PricingService } from "../pricing/pricing.service";
import { nextNumber } from "../common/number-series";
import * as crypto from "crypto";
import { GL, GL_EXPENSE } from "@ghasedak/contracts";
import { warehouseGlCode } from "../inventory/inventory.service";

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

/**
 * مدیریت کاربران ادمین + audit + تنظیمات + موجودی — همه با RBAC سمت سرور (بند ۷).
 */
@Controller("admin")
export class AdminPanelController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inv: InventoryService,
    private readonly settings: InventorySettingsService,
    private readonly journal: JournalService,
    private readonly pricing: PricingService,
  ) {}

  // ---------- کاربران ----------
  @Get("users")
  @RequirePermission("users.view")
  async users() {
    const rows = await this.prisma.user.findMany({
      where: { role: { not: "CUSTOMER" } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, email: true, mobile: true, name: true, role: true,
        status: true, lastLoginAt: true, createdAt: true,
      },
    });
    return { items: rows };
  }

  @Post("users")
  @RequirePermission("users.manage")
  async createUser(@Body() body: { email: string; password: string; name: string; role: string; mobile?: string }) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email ?? "")) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "ایمیل نامعتبر است." });
    }
    if ((body.password ?? "").length < 8) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "رمز حداقل ۸ کاراکتر." });
    }
    const role = body.role as never;
    if (!role || role === "CUSTOMER") {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "نقش ادمین انتخاب کنید." });
    }
    if (await this.prisma.user.findUnique({ where: { email: body.email } })) {
      throw new BadRequestException({ code: "DUPLICATE", message: "این ایمیل قبلاً ثبت شده است." });
    }
    return this.prisma.user.create({
      data: {
        email: body.email,
        name: body.name?.trim() || null,
        role,
        mobile: body.mobile ?? null,
        passwordHash: hashPassword(body.password),
      },
      select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
    });
  }

  @Post("users/:id/status")
  @RequirePermission("users.manage")
  async setUserStatus(@Param("id") id: string, @Body() body: { status: "ACTIVE" | "SUSPENDED" }) {
    return this.prisma.user.update({ where: { id }, data: { status: body.status } });
  }

  // ---------- Audit ----------
  @Get("audit")
  @RequirePermission("audit.view")
  async audit(@Query() q: { page?: string }) {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = 50;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count(),
    ]);
    return { items, total, page, limit };
  }

  // ---------- تنظیمات (کلید/مقدار JSON) ----------
  @Get("settings")
  @RequirePermission("settings.view")
  async getSettings() {
    const rows = await this.prisma.setting.findMany();
    const map: Record<string, unknown> = {};
    for (const r of rows) map[r.key] = r.value;
    return map;
  }

  @Post("settings")
  @RequirePermission("settings.manage")
  async setSetting(@Body() body: { key: string; value: unknown }) {
    if (!body.key?.trim()) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "کلید الزامی است." });
    await this.prisma.setting.upsert({
      where: { key: body.key },
      update: { value: body.value as object },
      create: { key: body.key, value: body.value as object },
    });
    return { ok: true };
  }

  /** موجودی (از منبع حقیقت Ledger) — نام متد inventory؛ سرویس انبار جدا تزریق نشده */
  @Get("inventory")
  @RequirePermission("inventory.view")
  async inventory(@Query() q: { q?: string; page?: string }) {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = 30;
    const variantWhere = q.q
      ? { OR: [{ sku: { contains: q.q } }, { barcode: { contains: q.q } }, { product: { name: { contains: q.q } } }] }
      : {};
    const variants = await this.prisma.productVariant.findMany({
      where: variantWhere,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        sku: true, barcode: true, stockQty: true, reservedQty: true, lowStockThreshold: true, price: true, status: true,
        product: { select: { name: true } },
      },
    });
    const total = await this.prisma.productVariant.count({ where: variantWhere });
    return { items: variants, total, page, limit };
  }

  // ---------- عملیات گروهی موجودی/قیمت (بند ۱۳۵: انبارگردانی) ----------

  /**
   * تعدیل گروهی قیمت — بند ۱۳: یکسان‌سازی با Pricing Domain (یادداشت باقی‌مانده Phase 5 / ریسک ۷).
   * هیچ مسیر مستقیمی دیگر VariantPrice/productVariant.price را نمی‌نویسد — همه چیز از
   * PricingService.changePrice می‌گذرد تا PriceHistory + رویداد PriceChanged همیشه ثبت شوند.
   * - با levelId → همان سطح؛ بدون levelId → سطح صریح «BASE» (قیمت پایه واریانت).
   * - mode «fixed» قدیم → «delta» جدید (تغییر مبلغی روی قیمت فعلی).
   * - مجوز: inventory.adjust یا pricing.manage (بجای مجوز درست عملیات قیمت).
   * - reason اختیاری برای ثبت در PriceHistory.
   */
  @Post("inventory/bulk-price")
  @RequirePermission("inventory.adjust", "pricing.manage")
  async bulkPrice(
    @Req() req: Request,
    @Body() body: { skus: string[]; mode: "percent" | "fixed"; amount: number; levelId?: string; reason?: string },
  ) {
    if (!Array.isArray(body.skus) || body.skus.length === 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "حداقل یک کالا انتخاب کنید." });
    }
    const n = Math.round(body.amount);
    if (body.mode === "percent") {
      if (!Number.isSafeInteger(n) || n < -90 || n > 100) {
        throw new BadRequestException({ code: "VALIDATION_ERROR", message: "درصد باید بین -۹۰ تا ۱۰۰ باشد." });
      }
    } else {
      if (!Number.isSafeInteger(n) || n === 0) {
        throw new BadRequestException({ code: "VALIDATION_ERROR", message: "مبلغ تغییر باید عدد صحیح غیرصفر باشد." });
      }
    }

    // سطح قیمت: levelId مستقیم → همان سطح؛ بدون levelId → سطح صریح BASE
    let levelCode: string;
    if (body.levelId) {
      const level = await this.prisma.priceLevel.findUnique({ where: { id: body.levelId }, select: { code: true } });
      if (!level) {
        throw new BadRequestException({ code: "LEVEL_INVALID", message: "سطح قیمت نامعتبر است." });
      }
      levelCode = level.code;
    } else {
      const base = await this.prisma.priceLevel.findUnique({ where: { code: "BASE" }, select: { code: true } });
      if (!base) {
        throw new BadRequestException({
          code: "LEVEL_INVALID",
          message: "سطح قیمت «BASE» یافت نشد — ابتدا seed را اجرا کنید.",
        });
      }
      levelCode = "BASE";
    }

    const actor = (req as unknown as Record<string, unknown>).adminIdentity as { userId?: string } | undefined;
    const result = await this.pricing.changePrice({
      skus: body.skus,
      levelCode,
      mode: body.mode === "fixed" ? "delta" : "percent",
      amount: n,
      reason: body.reason || "تعدیل گروهی از انبار",
      actorId: actor?.userId,
      source: "inventory-bulk",
    });
    return { changed: result.changed, level: result.level };
  }

  /** شروع انبارگردانی — snapshot همه واریانت‌های فعال انبار */
  @Post("stocktake")
  @RequirePermission("inventory.stocktake")
  async startStocktake(@Body() body: { warehouseId?: string; note?: string; toleranceQty?: number }) {
    const warehouse = body.warehouseId
      ? await this.prisma.warehouse.findUnique({ where: { id: body.warehouseId } })
      : await this.prisma.warehouse.findFirst({ where: { type: "main" } }) ?? await this.prisma.warehouse.findFirst();
    if (!warehouse) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "انبار یافت نشد." });
    // رواداری این انبارگردانی — اگر داده نشود، تنظیم سراسری هنگام بستن اعمال می‌شود
    const toleranceQty = body.toleranceQty != null ? Number(body.toleranceQty) : 0;
    if (!Number.isSafeInteger(toleranceQty) || toleranceQty < 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "رواداری باید عدد صحیح نامنفی باشد." });
    }
    const number = await this.prisma.$transaction(async (tx) => nextNumber(tx, "stocktake", "STK", 6));
    const variants = await this.prisma.productVariant.findMany({
      where: { status: "PUBLISHED", product: { deletedAt: null } },
      select: { sku: true, stockQty: true },
    });
    const st = await this.prisma.stocktake.create({
      data: {
        number,
        warehouseId: warehouse.id,
        note: body.note ?? null,
        toleranceQty,
        items: { create: variants.map((v) => ({ variantSku: v.sku, systemQty: v.stockQty })) },
      },
    });
    return { id: st.id, number, items: variants.length, toleranceQty };
  }

  /** لیست انبارگردانی‌ها */
  @Get("stocktake")
  @RequirePermission("inventory.view")
  async listStocktakes() {
    const items = await this.prisma.stocktake.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { _count: { select: { items: true } } },
    });
    return { items };
  }

  /** جزئیات یک انبارگردانی با آیتم‌ها */
  @Get("stocktake/:id")
  @RequirePermission("inventory.view")
  async getStocktake(@Param("id") id: string) {
    const st = await this.prisma.stocktake.findUnique({
      where: { id },
      include: {
        items: { include: { variant: { select: { sku: true, product: { select: { name: true } } } } } },
      },
    });
    if (!st) throw new BadRequestException({ code: "NOT_FOUND", message: "انبارگردانی یافت نشد." });
    return st;
  }

  /** ثبت شمارش یک ردیف */
  @Post("stocktake/:id/count")
  @RequirePermission("inventory.stocktake")
  async countItem(@Param("id") id: string, @Body() body: { itemId: string; countedQty: number }) {
    if (!Number.isSafeInteger(body.countedQty) || body.countedQty < 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "تعداد شمارش نامعتبر است." });
    }
    const st = await this.prisma.stocktake.findUnique({ where: { id } });
    if (!st || st.state !== "OPEN") throw new BadRequestException({ code: "NOT_OPEN", message: "انبارگردانی بازی نیست." });
    const item = await this.prisma.stocktakeItem.findUnique({ where: { id: body.itemId } });
    if (!item || item.stocktakeId !== id) throw new BadRequestException({ code: "NOT_FOUND", message: "ردیف یافت نشد." });
    return this.prisma.stocktakeItem.update({
      where: { id: item.id },
      data: { countedQty: body.countedQty, difference: body.countedQty - item.systemQty },
    });
  }

  /**
   * بستن انبارگردانی — اختلاف هر ردیف به‌صورت ADJUSTMENT در Ledger؛
   * برای هر دو حالت سند حسابداری خودکار صادر می‌شود:
   *   کسری → بدهکار هزینهٔ کسری (6000) / بستانکار موجودی (1200)
   *   مازاد → بدهکار موجودی (1200) / بستانکار هزینهٔ کسری (6000)
   *
   * چرا برای مازاد هم سند؟ چون مازاد هم یعنی موجودی کالا و بهای آن باید در
   * دفاتر دیده شود؛ بدون سند، ارزش موجودی فروشگاه با انبار فیزیکی نمی‌خواند
   * و تراز آزمایشی گمراه می‌شود.
   */
  @Post("stocktake/:id/close")
  @RequirePermission("inventory.stocktake")
  async closeStocktake(@Param("id") id: string, @Body() body: { actorId?: string }) {
    const st = await this.prisma.stocktake.findUnique({ where: { id }, include: { items: true } });
    if (!st || st.state !== "OPEN") throw new BadRequestException({ code: "NOT_OPEN", message: "انبارگردانی بازی نیست." });
    // بند ۱۰۱: اختلاف‌های بالای تحمل پیش از بستن باید تایید شوند —
    // رواداریِ خودِ این انبارگردانی (toleranceQty) اولویت دارد؛ اگر صفر بود، تنظیم سراسری
    const threshold = st.toleranceQty > 0 ? st.toleranceQty : await this.settings.get<number>("adjustmentApprovalThreshold");
    const needsApproval = st.items.some((i) => i.countedQty != null && Math.abs((i.countedQty ?? 0) - i.systemQty) > threshold);
    if (needsApproval && !st.approvedById) {
      throw new BadRequestException({
        code: "APPROVAL_REQUIRED",
        message: "اختلاف‌های بالای تحمل نیاز به تایید مدیر دارند (از بخش تایید انبار).",
      });
    }
    const counted = st.items.filter((i) => i.countedQty != null);
    if (counted.length === 0) throw new BadRequestException({ code: "EMPTY_COUNT", message: "هیچ ردیفی شمارش نشده است." });

    let lossValue = 0n;
    let surplusValue = 0n;
    const adjusted: Array<{ sku: string; diff: number }> = [];
    /** ردیف‌هایی که بهای واقعی نداشتند و با قیمت فروش بهاگذاری شدند */
    const noCostSkus: string[] = [];

    /**
     * بهای واحد یک واریانت — با اولویت و شفاف:
     *   ۱) بهای خرید ثبت‌شده روی محصول
     *   ۲) میانگین موزون (CostLayer) در همان انبار
     *   ۳) قیمت فروش — تقریبی و اعلام‌شده
     *
     * چرا این‌قدر سخت‌گیرانه؟ قبلاً اگر costPrice خالی بود، واحد صفر می‌شد و
     * کل سند حسابداری بی‌صدا حذف می‌شد؛ یعنی موجودی انبار تغییر می‌کرد ولی
     * دفاتر بی‌خبر می‌ماندند — بدترین حالت ممکن در حسابداری. حالا سند همیشه
     * ثبت می‌شود و اگر بهای واقعی نبوده، در پاسخ گزارش می‌شود.
     */
    const unitCostOf = async (sku: string): Promise<{ cost: number; estimated: boolean }> => {
      const variant = await this.prisma.productVariant.findUnique({
        where: { sku },
        include: { product: { select: { costPrice: true, basePrice: true } } },
      });
      if (variant?.product?.costPrice != null) {
        return { cost: Number(variant.product.costPrice), estimated: false };
      }
      const layer = await this.prisma.costLayer.findFirst({
        where: { warehouseId: st.warehouseId, variantSku: sku },
        orderBy: { updatedAt: "desc" },
      });
      const wac = layer?.avgUnitCost != null ? Number(layer.avgUnitCost) : 0;
      if (wac > 0) return { cost: wac, estimated: false };
      const fallback = variant?.product?.basePrice != null ? Number(variant.product.basePrice) : 0;
      return { cost: fallback, estimated: true };
    };

    for (const item of counted) {
      const diff = item.countedQty! - item.systemQty;
      if (diff === 0) continue;
      const { cost: unitCost, estimated } = await unitCostOf(item.variantSku);
      if (estimated) noCostSkus.push(item.variantSku);

      if (diff > 0) {
        surplusValue += BigInt(diff * unitCost);
        await this.inv.move({
          warehouseId: st.warehouseId,
          variantSku: item.variantSku,
          type: "ADJUSTMENT",
          qty: diff,
          refType: "stocktake",
          refId: st.id,
          idempotencyKey: `stk:${st.id}:${item.variantSku}`,
          actorId: body.actorId,
          note: `انبارگردانی ${st.number} — مازاد`,
        });
      } else {
        lossValue += BigInt(-diff * unitCost);
        await this.inv.move({
          warehouseId: st.warehouseId,
          variantSku: item.variantSku,
          type: "ADJUSTMENT",
          qty: -diff,
          refType: "stocktake",
          refId: st.id,
          idempotencyKey: `stk:${st.id}:${item.variantSku}`,
          actorId: body.actorId,
          note: `انبارگردانی ${st.number} — کسری`,
        });
      }
      adjusted.push({ sku: item.variantSku, diff });
    }

    // حساب موجودیِ همان انباری که انبارگردانی در آن انجام شده (فاز ۶)
    const stInvCode = await warehouseGlCode(this.prisma, st.warehouseId);

    // سند کسری — هزینه بدهکار، موجودی بستانکار
    if (lossValue > 0n) {
      await this.journal.postOrNotify({
        description: `کسری انبارگردانی ${st.number}`,
        sourceType: "stocktake",
        sourceId: st.id,
        warehouseId: st.warehouseId,
        actorId: body.actorId,
        lines: [
          { accountCode: GL_EXPENSE.OPERATING, debit: Number(lossValue) },
          { accountCode: stInvCode, credit: Number(lossValue) },
        ],
      });
    }

    // سند مازاد — موجودی بدهکار، هزینهٔ کسری بستانکار (آینهٔ سند بالا)
    if (surplusValue > 0n) {
      await this.journal.postOrNotify({
        description: `مازاد انبارگردانی ${st.number}`,
        sourceType: "stocktake",
        sourceId: st.id,
        warehouseId: st.warehouseId,
        actorId: body.actorId,
        lines: [
          { accountCode: stInvCode, debit: Number(surplusValue) },
          { accountCode: GL_EXPENSE.OPERATING, credit: Number(surplusValue) },
        ],
      });
    }

    await this.prisma.stocktake.update({ where: { id: st.id }, data: { state: "CLOSED", closedAt: new Date() } });
    return {
      adjusted: adjusted.length,
      lossValue: lossValue.toString(),
      surplusValue: surplusValue.toString(),
      // اگر بهای واقعی نبود، به اپراتور می‌گوییم تا بهای خرید را وارد کند
      noCostSkus: [...new Set(noCostSkus)],
    };
  }

  /** عملیات گروهی وضعیت واریانت (فعال/غیرفعال) */
  @Post("inventory/bulk-status")
  @RequirePermission("inventory.adjust")
  async bulkStatus(@Body() body: { skus: string[]; status: "PUBLISHED" | "DRAFT" }) {
    if (!Array.isArray(body.skus) || body.skus.length === 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "حداقل یک کالا انتخاب کنید." });
    }
    const r = await this.prisma.productVariant.updateMany({
      where: { sku: { in: body.skus } },
      data: { status: body.status },
    });
    return { changed: r.count };
  }

  // ---------- زنگ ادمین (نوتیفیکیشن) ----------
  @Get("notifications")
  @RequirePermission("dashboard.view")
  async notifications(@Query() q: { since?: string }) {
    const since = q.since ? new Date(q.since) : new Date(Date.now() - 24 * 3600_000);
    const items = await this.prisma.notification.findMany({
      where: { channel: "ADMIN", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return { items, serverNow: new Date().toISOString() };
  }

  /**
   * درس ریسک ۶ — شکست‌های ثبت سند حسابداری (۷ روز اخیر):
   * منبع حقیقت = Notification(ADMIN) با templateKey `journal-fail:*` که postOrNotify می‌سازد +
   * AuditLog accounting.post.failure برای count دائمی. برای بنر هشدار در UI حسابداری.
   */
  @Get("accounting/post-failures")
  @RequirePermission("accounting.view")
  async postFailures() {
    const since = new Date(Date.now() - 7 * 24 * 3600_000);
    const [notifs, auditCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { channel: "ADMIN", templateKey: { startsWith: "journal-fail:" }, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 25,
      }),
      this.prisma.auditLog.count({ where: { action: "accounting.post.failure", createdAt: { gte: since } } }),
    ]);
    return {
      items: notifs.map((n) => {
        const p = (n.payload ?? {}) as {
          code?: string; message?: string; sourceType?: string | null; sourceId?: string | null;
          description?: string | null; lines?: Array<{ accountCode?: string; debit?: number; credit?: number }>;
        };
        return {
          id: n.id,
          key: n.templateKey,
          code: p.code ?? "UNKNOWN",
          message: p.message ?? "",
          sourceType: p.sourceType ?? null,
          sourceId: p.sourceId ?? null,
          description: p.description ?? null,
          lines: p.lines ?? [],
          at: n.createdAt,
        };
      }),
      failureCount7d: auditCount,
    };
  }
}

void Query;
