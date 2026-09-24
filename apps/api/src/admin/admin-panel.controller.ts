import { BadRequestException, Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RequirePermission } from "../auth/permissions.guard";
import { InventoryService } from "../inventory/inventory.service";
import { InventorySettingsService } from "../inventory/inventory-settings.service";
import { JournalService } from "../accounting/journal.service";
import { nextNumber } from "../common/number-series";
import * as crypto from "crypto";

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

  /** تعدیل گروهی قیمت — درصدی یا مبلغی روی واریانت‌های انتخابی؛ فقط با مجوز */
  @Post("inventory/bulk-price")
  @RequirePermission("inventory.adjust")
  async bulkPrice(@Body() body: { skus: string[]; mode: "percent" | "fixed"; amount: number; levelId?: string }) {
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
    const result = await this.prisma.$transaction(async (tx) => {
      let changed = 0;
      for (const sku of body.skus) {
        if (body.levelId) {
          const vp = await tx.variantPrice.findUnique({ where: { variantSku_priceLevelId: { variantSku: sku, priceLevelId: body.levelId } } });
          if (!vp) continue;
          const old = Number(vp.price);
          const next = Math.max(0, body.mode === "percent" ? Math.round((old * (100 + n)) / 100) : old + n);
          await tx.variantPrice.update({ where: { variantSku_priceLevelId: { variantSku: sku, priceLevelId: body.levelId } }, data: { price: BigInt(next) } });
        } else {
          const v = await tx.productVariant.findUnique({ where: { sku } });
          if (!v) continue;
          const old = Number(v.price);
          const next = Math.max(0, body.mode === "percent" ? Math.round((old * (100 + n)) / 100) : old + n);
          await tx.productVariant.update({ where: { sku }, data: { price: BigInt(next) } });
        }
        changed += 1;
      }
      return changed;
    });
    return { changed: result };
  }

  /** شروع انبارگردانی — snapshot همه واریانت‌های فعال انبار */
  @Post("stocktake")
  @RequirePermission("inventory.stocktake")
  async startStocktake(@Body() body: { warehouseId?: string; note?: string }) {
    const warehouse = body.warehouseId
      ? await this.prisma.warehouse.findUnique({ where: { id: body.warehouseId } })
      : await this.prisma.warehouse.findFirst({ where: { type: "main" } }) ?? await this.prisma.warehouse.findFirst();
    if (!warehouse) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "انبار یافت نشد." });
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
        items: { create: variants.map((v) => ({ variantSku: v.sku, systemQty: v.stockQty })) },
      },
    });
    return { id: st.id, number, items: variants.length };
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
   * سند حسابداری خسارت/کسر برای کل اختلاف منفی (بها میانگین) صادر می‌شود.
   */
  @Post("stocktake/:id/close")
  @RequirePermission("inventory.stocktake")
  async closeStocktake(@Param("id") id: string, @Body() body: { actorId?: string }) {
    const st = await this.prisma.stocktake.findUnique({ where: { id }, include: { items: true } });
    if (!st || st.state !== "OPEN") throw new BadRequestException({ code: "NOT_OPEN", message: "انبارگردانی بازی نیست." });
    // بند ۱۰۱: اختلاف‌های بالای تحمل (تنظیم inventory.adjustmentApprovalThreshold) پیش از بستن باید تایید شوند
    const threshold = await this.settings.get<number>("adjustmentApprovalThreshold");
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
    const adjusted: Array<{ sku: string; diff: number }> = [];
    for (const item of counted) {
      const diff = item.countedQty! - item.systemQty;
      if (diff === 0) continue;
      if (diff > 0) {
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
        const variant = await this.prisma.productVariant.findUnique({
          where: { sku: item.variantSku },
          include: { product: { select: { costPrice: true } } },
        });
        const unitCost = variant?.product?.costPrice != null ? Number(variant.product.costPrice) : 0;
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
          note: `انبارگردانی ${st.number} — کسری` + (variant?.barcode ? ` [بارکد ${variant.barcode}]` : ""),
        });
      }
      adjusted.push({ sku: item.variantSku, diff });
    }
    if (lossValue > 0n) {
      await this.journal.post({
        description: `کسری انبارگردانی ${st.number}`,
        sourceType: "stocktake",
        sourceId: st.id,
        actorId: body.actorId,
        lines: [
          { accountCode: "6000", debit: Number(lossValue) },
          { accountCode: "1200", credit: Number(lossValue) },
        ],
      });
    }
    await this.prisma.stocktake.update({ where: { id: st.id }, data: { state: "CLOSED", closedAt: new Date() } });
    return { adjusted: adjusted.length, lossValue: lossValue.toString() };
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
}

void Query;
