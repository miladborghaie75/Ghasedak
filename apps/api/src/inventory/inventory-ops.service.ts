import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { InventoryService } from "./inventory.service";
import { nextNumber } from "../common/number-series";

/**
 * عملیات انبار — انتقال بین‌انباری، قرنطینه، خرابی/مفقودی، انبارها، دفتر ریسی.
 * همهٔ حرکت‌ها از InventoryService.moveInTx (Ledger منبع حقیقت، idempotent) عبور می‌کنند.
 */

const WAREHOUSE_TYPES = ["main", "store", "branch", "transit", "quarantine", "returns", "other"];

function qtyPositive(n: unknown, label: string): number {
  const v = Number(n);
  if (!Number.isSafeInteger(v) || v <= 0) {
    throw new BadRequestException({ code: "VALIDATION_ERROR", message: `تعداد «${label}» باید عدد صحیح مثبت باشد.` });
  }
  return v;
}

@Injectable()
export class InventoryOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inv: InventoryService,
  ) {}

  // ---------------- انبارها ----------------

  async listWarehouses() {
    const items = await this.prisma.warehouse.findMany({
      orderBy: [{ active: "desc" }, { priority: "desc" }],
      select: { id: true, code: true, name: true, type: true, address: true, phone: true, contact: true, isDefault: true, active: true, note: true },
    });
    return { items };
  }

  async createWarehouse(input: { code: string; name: string; type?: string; address?: string; phone?: string; contact?: string; note?: string; actorId?: string }) {
    const code = input.code?.trim().toUpperCase();
    if (!code || !/^[A-Z0-9_-]{2,20}$/.test(code)) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "کد انبار ۲ تا ۲۰ کاراکتر لاتین/عدد است." });
    }
    if (!input.name?.trim()) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "نام انبار الزامی است." });
    const type = input.type ?? "main";
    if (!WAREHOUSE_TYPES.includes(type)) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "نوع انبار نامعتبر است." });
    }
    if (await this.prisma.warehouse.findUnique({ where: { code } })) {
      throw new ConflictException({ code: "DUPLICATE", message: "این کد انبار قبلاً ثبت شده است." });
    }
    const wh = await this.prisma.warehouse.create({
      data: { code, name: input.name.trim(), type, address: input.address, phone: input.phone, contact: input.contact, note: input.note },
    });
    await this.audit(input.actorId, "inventory.warehouse.create", "Warehouse", wh.id, { code, type });
    return wh;
  }

  async updateWarehouse(id: string, input: { name?: string; type?: string; address?: string; phone?: string; contact?: string; note?: string; active?: boolean; isDefault?: boolean; actorId?: string }) {
    const wh = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!wh) throw new NotFoundException({ code: "NOT_FOUND", message: "انبار یافت نشد." });
    if (input.type && !WAREHOUSE_TYPES.includes(input.type)) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "نوع انبار نامعتبر است." });
    }
    if (input.active === false && wh.isDefault) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "انبار پیش‌فرض قابل غیرفعال‌سازی نیست." });
    }
    const data: Record<string, unknown> = {};
    for (const k of ["name", "type", "address", "phone", "contact", "note"] as const) {
      if (input[k] !== undefined) data[k] = input[k];
    }
    if (input.active !== undefined) data.active = input.active;
    if (input.isDefault === true) {
      // تنها یک انبار پیش‌فرض
      await this.prisma.warehouse.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      data.isDefault = true;
      data.active = true;
    }
    const updated = await this.prisma.warehouse.update({ where: { id }, data: data as never });
    await this.audit(input.actorId, "inventory.warehouse.update", "Warehouse", id, data);
    return updated;
  }

  // ---------------- دفتر ریسی ----------------

  async ledger(q: { warehouseId?: string; sku?: string; type?: string; from?: string; to?: string; page?: string }) {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = 50;
    const where: Record<string, unknown> = {};
    if (q.warehouseId) where.warehouseId = q.warehouseId;
    if (q.sku) where.variantSku = { contains: q.sku };
    if (q.type) where.type = q.type;
    if (q.from || q.to) {
      where.createdAt = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) };
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.stockLedgerEntry.findMany({
        where: where as never,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          warehouse: { select: { code: true, name: true } },
          variant: { select: { sku: true, product: { select: { name: true } } } },
          actor: { select: { name: true, email: true } },
        },
      }),
      this.prisma.stockLedgerEntry.count({ where: where as never }),
    ]);
    return { items, total, page, limit };
  }

  // ---------------- انتقال بین‌انباری ----------------

  async createTransfer(input: { fromWarehouseId: string; toWarehouseId: string; lines: Array<{ variantSku: string; qty: number }>; note?: string; actorId?: string }) {
    if (input.fromWarehouseId === input.toWarehouseId) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "مبدأ و مقصد یکسان نیستند." });
    }
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "حداقل یک ردیف لازم است." });
    }
    const [fromWh, toWh] = await Promise.all([
      this.prisma.warehouse.findUnique({ where: { id: input.fromWarehouseId } }),
      this.prisma.warehouse.findUnique({ where: { id: input.toWarehouseId } }),
    ]);
    if (!fromWh || !toWh) throw new NotFoundException({ code: "NOT_FOUND", message: "انبار مبدأ/مقصد یافت نشد." });
    if (!fromWh.active || !toWh.active) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "انبار مبدأ/مقصد غیرفعال است." });
    const lines = input.lines.map((l) => ({ variantSku: String(l.variantSku), qty: qtyPositive(l.qty, l.variantSku) }));

    const transfer = await this.prisma.stockTransfer.create({
      data: {
        number: await this.prisma.$transaction((tx) => nextNumber(tx, "stock_transfer", "TRF", 5)),
        fromWarehouseId: fromWh.id,
        toWarehouseId: toWh.id,
        note: input.note,
        requestedById: input.actorId,
        items: { create: lines },
      },
      include: { items: true },
    });
    await this.audit(input.actorId, "inventory.transfer.create", "StockTransfer", transfer.id, { number: transfer.number, lines: lines.length });
    return transfer;
  }

  async listTransfers(q: { state?: string; page?: string }) {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = 30;
    const where = q.state ? { state: q.state as never } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.stockTransfer.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          fromWarehouse: { select: { code: true, name: true } },
          toWarehouse: { select: { code: true, name: true } },
          requestedBy: { select: { name: true } },
          confirmedBy: { select: { name: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.stockTransfer.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async getTransfer(id: string) {
    const t = await this.prisma.stockTransfer.findUnique({
      where: { id },
      include: {
        items: { include: { variant: { select: { sku: true, product: { select: { name: true } } } } } },
        fromWarehouse: { select: { code: true, name: true } },
        toWarehouse: { select: { code: true, name: true } },
        requestedBy: { select: { name: true } },
        confirmedBy: { select: { name: true } },
      },
    });
    if (!t) throw new NotFoundException({ code: "NOT_FOUND", message: "انتقال یافت نشد." });
    return t;
  }

  /** ارسال — TRANSFER_OUT از مبدأ (با چک موجودی) */
  async confirmTransfer(id: string, actorId?: string) {
    const t = await this.prisma.stockTransfer.findUnique({ where: { id }, include: { items: true } });
    if (!t) throw new NotFoundException({ code: "NOT_FOUND", message: "انتقال یافت نشد." });
    if (t.state !== "DRAFT") throw new BadRequestException({ code: "INVALID_STATE", message: "فقط انتقال در وضعیت DRAFT قابل ارسال است." });
    await this.prisma.$transaction(async (tx) => {
      for (const item of t.items) {
        await this.inv.moveInTx(tx, {
          warehouseId: t.fromWarehouseId,
          variantSku: item.variantSku,
          type: "TRANSFER_OUT",
          qty: item.qty,
          refType: "transfer",
          refId: t.id,
          idempotencyKey: `trf:${t.id}:${item.variantSku}:out`,
          actorId,
          note: `انتقال ${t.number} — ارسال`,
        });
      }
      await tx.stockTransfer.update({ where: { id: t.id }, data: { state: "IN_TRANSIT", confirmedById: actorId } });
    });
    await this.audit(actorId, "inventory.transfer.confirm", "StockTransfer", id, { number: t.number });
    return { ok: true };
  }

  /** دریافت — TRANSFER_IN به مقصد (فقط پس از ارسال) */
  async receiveTransfer(id: string, actorId?: string) {
    const t = await this.prisma.stockTransfer.findUnique({ where: { id }, include: { items: true } });
    if (!t) throw new NotFoundException({ code: "NOT_FOUND", message: "انتقال یافت نشد." });
    if (t.state !== "IN_TRANSIT") throw new BadRequestException({ code: "INVALID_STATE", message: "فقط انتقال در راه قابل دریافت است." });
    await this.prisma.$transaction(async (tx) => {
      for (const item of t.items) {
        await this.inv.moveInTx(tx, {
          warehouseId: t.toWarehouseId,
          variantSku: item.variantSku,
          type: "TRANSFER_IN",
          qty: item.qty,
          refType: "transfer",
          refId: t.id,
          idempotencyKey: `trf:${t.id}:${item.variantSku}:in`,
          actorId,
          note: `انتقال ${t.number} — دریافت`,
        });
      }
      await tx.stockTransfer.update({ where: { id: t.id }, data: { state: "DONE" } });
    });
    await this.audit(actorId, "inventory.transfer.receive", "StockTransfer", id, { number: t.number });
    return { ok: true };
  }

  async cancelTransfer(id: string, actorId?: string) {
    const t = await this.prisma.stockTransfer.findUnique({ where: { id } });
    if (!t) throw new NotFoundException({ code: "NOT_FOUND", message: "انتقال یافت نشد." });
    if (t.state === "DONE") throw new BadRequestException({ code: "INVALID_STATE", message: "انتقال انجام‌شده قابل لغو نیست." });
    if (t.state === "IN_TRANSIT") {
      throw new BadRequestException({ code: "INVALID_STATE", message: "انتقال در راه — ابتدا دریافت یا اصلاح دستی انبار." });
    }
    await this.prisma.stockTransfer.update({ where: { id }, data: { state: "CANCELLED" } });
    await this.audit(actorId, "inventory.transfer.cancel", "StockTransfer", id, { number: t.number });
    return { ok: true };
  }

  // ---------------- قرنطینه ----------------

  /** جداسازی — موجودی از قابل‌فروش کسر می‌شود (CORRECTION منفی)؛ OnHand ثابت */
  async quarantineHold(input: { warehouseId: string; variantSku: string; qty: number; reason: string; refType?: string; refId?: string; actorId?: string; note?: string }) {
    const qty = qtyPositive(input.qty, input.variantSku);
    if (!input.reason?.trim()) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "دلیل قرنطینه الزامی است." });
    const wh = await this.prisma.warehouse.findUnique({ where: { id: input.warehouseId } });
    if (!wh) throw new NotFoundException({ code: "NOT_FOUND", message: "انبار یافت نشد." });
    const record = await this.prisma.$transaction(async (tx) => {
      const cur = await this.inv.availableInTx(tx, input.warehouseId, input.variantSku);
      if (cur.available < qty) {
        throw new ConflictException({ code: "INSUFFICIENT_STOCK", message: "موجودی قابل‌فروش برای قرنطینه کافی نیست." });
      }
      const number = await nextNumber(tx, "quarantine", "QRN", 5);
      const rec = await tx.quarantineRecord.create({
        data: {
          number,
          warehouseId: input.warehouseId,
          variantSku: input.variantSku,
          qty,
          reason: input.reason.trim(),
          refType: input.refType,
          refId: input.refId,
          actorId: input.actorId,
          note: input.note,
        },
      });
      // مدل منطقی: OnHand ثابت می‌ماند؛ فقط QuarantineRecord.state=HELD
      // در محاسبه available کسر می‌شود (بند ۳۵) — Ledger دست نمی‌خورد
      return rec;
    });
    await this.audit(input.actorId, "inventory.quarantine.hold", "QuarantineRecord", record.id, { number: record.number, qty });
    return record;
  }

  /** بازگشت از قرنطینه به قابل‌فروش */
  async quarantineRelease(id: string, actorId?: string, note?: string) {
    const rec = await this.prisma.quarantineRecord.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException({ code: "NOT_FOUND", message: "رکورد قرنطینه یافت نشد." });
    if (rec.state !== "HELD") throw new BadRequestException({ code: "INVALID_STATE", message: "فقط قرنطینهٔ در جریان قابل تغییر است." });
    // بازگشت منطقی: رکورد RELEASED می‌شود → available خودش برمی‌گردد؛ Ledger دست نمی‌خورد
    await this.prisma.quarantineRecord.update({
      where: { id: rec.id },
      data: { state: "RELEASED", releasedAt: new Date(), note: note ? `${rec.note ?? ""} — ${note}`.trim() : rec.note },
    });
    await this.audit(actorId, "inventory.quarantine.release", "QuarantineRecord", id, { number: rec.number });
    return { ok: true };
  }

  /** انهدام — خروج واقعی (DAMAGE) + سند DamageRecord + سند حسابداری در کنترلر */
  async quarantineDestroy(id: string, actorId?: string, note?: string): Promise<{ damageRecordId: string; number: string; value: number }> {
    const rec = await this.prisma.quarantineRecord.findUnique({ where: { id }, include: { variant: { include: { product: { select: { costPrice: true } } } } } });
    if (!rec) throw new NotFoundException({ code: "NOT_FOUND", message: "رکورد قرنطینه یافت نشد." });
    if (rec.state !== "HELD") throw new BadRequestException({ code: "INVALID_STATE", message: "فقط قرنطینهٔ در جریان قابل انهدام است." });
    const result = await this.prisma.$transaction(async (tx) => {
      const unitCost = await this.inv.wacInTx(tx, rec.warehouseId, rec.variantSku)
        ?? (rec.variant.product.costPrice != null ? BigInt(rec.variant.product.costPrice) : 0n);
      const value = unitCost * BigInt(rec.qty);
      await this.inv.moveInTx(tx, {
        warehouseId: rec.warehouseId,
        variantSku: rec.variantSku,
        type: "DAMAGE",
        qty: rec.qty,
        unitCost,
        refType: "quarantine",
        refId: rec.id,
        idempotencyKey: `qrn-dest:${rec.number}`,
        actorId,
        note: `انهدام قرنطینه ${rec.number}` + (note ? ` — ${note}` : ""),
      });
      const number = await nextNumber(tx, "damage", "DMG", 5);
      const dmg = await tx.damageRecord.create({
        data: {
          number,
          warehouseId: rec.warehouseId,
          variantSku: rec.variantSku,
          qty: rec.qty,
          kind: "damage",
          reason: `انهدام قرنطینه ${rec.number}`,
          unitCost,
          state: "POSTED",
          refType: "quarantine",
          refId: rec.id,
          actorId,
          note,
        },
      });
      await tx.quarantineRecord.update({ where: { id: rec.id }, data: { state: "DESTROYED", releasedAt: new Date() } });
      return { damageRecordId: dmg.id, number, value: Number(value) };
    });
    await this.audit(actorId, "inventory.quarantine.destroy", "QuarantineRecord", id, { number: rec.number, value: result.value });
    return result;
  }

  async listQuarantine(q: { state?: string; page?: string }) {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = 30;
    const where = q.state ? { state: q.state as never } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.quarantineRecord.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          warehouse: { select: { code: true, name: true } },
          variant: { select: { sku: true, product: { select: { name: true } } } },
        },
      }),
      this.prisma.quarantineRecord.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  // ---------------- خرابی / مفقودی ----------------

  /**
   * ثبت خرابی/مفقودی — POSTED بلافاصله از انبار کم می‌کند (WAC)؛
   * holdForApproval=true → DRAFT بدون حرکت انبار؛ post() بعداً ثبت می‌کند.
   */
  async reportDamage(input: { warehouseId: string; variantSku: string; qty: number; kind: "damage" | "loss"; reason?: string; holdForApproval?: boolean; actorId?: string; note?: string }) {
    const qty = qtyPositive(input.qty, input.variantSku);
    const kind = input.kind === "loss" ? "loss" : "damage";
    const wh = await this.prisma.warehouse.findUnique({ where: { id: input.warehouseId } });
    if (!wh) throw new NotFoundException({ code: "NOT_FOUND", message: "انبار یافت نشد." });
    const created = await this.prisma.$transaction(async (tx) => {
      const number = await nextNumber(tx, "damage", "DMG", 5);
      const unitCost = (await this.inv.wacInTx(tx, input.warehouseId, input.variantSku)) ?? 0n;
      const rec = await tx.damageRecord.create({
        data: {
          number,
          warehouseId: input.warehouseId,
          variantSku: input.variantSku,
          qty,
          kind,
          reason: input.reason,
          unitCost,
          state: input.holdForApproval ? "DRAFT" : "POSTED",
          refType: "manual",
          actorId: input.actorId,
          note: input.note,
        },
      });
      if (!input.holdForApproval) {
        await this.inv.moveInTx(tx, {
          warehouseId: input.warehouseId,
          variantSku: input.variantSku,
          type: kind === "loss" ? "LOSS" : "DAMAGE",
          qty,
          unitCost,
          refType: "damage",
          refId: rec.id,
          idempotencyKey: `dmg:${number}`,
          actorId: input.actorId,
          note: reasonNote(kind, input.reason),
        });
      }
      return rec;
    });
    await this.audit(input.actorId, "inventory.damage.report", "DamageRecord", created.id, { number: created.number, kind, qty, state: created.state });
    return created;
  }

  /** ثبت نهایی سند معلق — خروج از انبار */
  async postDamage(id: string, actorId?: string) {
    const rec = await this.prisma.damageRecord.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException({ code: "NOT_FOUND", message: "سند خرابی یافت نشد." });
    if (rec.state !== "DRAFT") throw new BadRequestException({ code: "INVALID_STATE", message: "فقط سند معلق قابل ثبت است." });
    await this.prisma.$transaction(async (tx) => {
      const unitCost = (await this.inv.wacInTx(tx, rec.warehouseId, rec.variantSku)) ?? rec.unitCost;
      await this.inv.moveInTx(tx, {
        warehouseId: rec.warehouseId,
        variantSku: rec.variantSku,
        type: rec.kind === "loss" ? "LOSS" : "DAMAGE",
        qty: rec.qty,
        unitCost,
        refType: "damage",
        refId: rec.id,
        idempotencyKey: `dmg:${rec.number}`,
        actorId,
        note: reasonNote(rec.kind, rec.reason),
      });
      await tx.damageRecord.update({ where: { id: rec.id }, data: { state: "POSTED", unitCost } });
    });
    await this.audit(actorId, "inventory.damage.post", "DamageRecord", id, { number: rec.number });
    return { ok: true };
  }

  async cancelDamage(id: string, actorId?: string) {
    const rec = await this.prisma.damageRecord.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException({ code: "NOT_FOUND", message: "سند خرابی یافت نشد." });
    if (rec.state !== "DRAFT") throw new BadRequestException({ code: "INVALID_STATE", message: "سند ثبت‌شده قابل لغو نیست — اصلاح با سند معکوس انجام شود." });
    await this.prisma.damageRecord.update({ where: { id }, data: { state: "CANCELLED" } });
    await this.audit(actorId, "inventory.damage.cancel", "DamageRecord", id, { number: rec.number });
    return { ok: true };
  }

  async listDamage(q: { state?: string; kind?: string; page?: string }) {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = 30;
    const where: Record<string, unknown> = {};
    if (q.state) where.state = q.state;
    if (q.kind) where.kind = q.kind;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.damageRecord.findMany({
        where: where as never,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          warehouse: { select: { code: true, name: true } },
          variant: { select: { sku: true, product: { select: { name: true } } } },
        },
      }),
      this.prisma.damageRecord.count({ where: where as never }),
    ]);
    return { items, total, page, limit };
  }

  async audit(actorId: string | undefined, action: string, entity: string, entityId: string, meta: Record<string, unknown>): Promise<void> {
    await this.prisma.auditLog.create({
      data: { actorId: actorId ?? null, action, entity, entityId, newValues: meta as object },
    }).catch(() => undefined);
  }
}

function reasonNote(kind: string, reason?: string | null): string {
  const label = kind === "loss" ? "مفقودی" : "خرابی";
  return reason ? `${label} — ${reason}` : label;
}
