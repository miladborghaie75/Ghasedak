import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { RequirePermission } from "../auth/permissions.guard";
import { JournalService } from "../accounting/journal.service";
import { InventoryOpsService } from "./inventory-ops.service";
import { InventoryReportsService } from "./inventory-reports.service";
import { InventorySettingsService } from "./inventory-settings.service";
import { InventoryService } from "./inventory.service";
import { EventBusService } from "../events/event-bus.service";
import { INVENTORY_SETTINGS } from "./inventory-settings";

/** کنترلر انبار — همه مسیرها با @RequirePermission محافظت می‌شوند (بند ۷) */
@Controller("admin/inventory-ops")
export class InventoryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inv: InventoryService,
    private readonly ops: InventoryOpsService,
    private readonly reports: InventoryReportsService,
    private readonly settings: InventorySettingsService,
    private readonly journal: JournalService,
    private readonly events: EventBusService,
  ) {}

  private actor(req: Request): string | undefined {
    const id = (req as unknown as Record<string, unknown>).adminIdentity as { userId?: string } | undefined;
    return id?.userId;
  }

  // ---------------- داشبورد ----------------

  @Get("dashboard")
  @RequirePermission("inventory.view")
  async dashboard() {
    return this.reports.dashboard();
  }

  // ---------------- انبارها ----------------

  @Get("warehouses")
  @RequirePermission("inventory.view")
  async warehouses() {
    return this.ops.listWarehouses();
  }

  @Post("warehouses")
  @RequirePermission("inventory.manage")
  async createWarehouse(@Req() req: Request, @Body() body: { code: string; name: string; type?: string; address?: string; phone?: string; contact?: string; note?: string }) {
    return this.ops.createWarehouse({ ...body, actorId: this.actor(req) });
  }

  @Post("warehouses/:id")
  @RequirePermission("inventory.manage")
  async updateWarehouse(@Req() req: Request, @Param("id") id: string, @Body() body: { name?: string; type?: string; address?: string; phone?: string; contact?: string; note?: string; active?: boolean; isDefault?: boolean }) {
    return this.ops.updateWarehouse(id, { ...body, actorId: this.actor(req) });
  }

  // ---------------- دفتر ریسی ----------------

  @Get("ledger")
  @RequirePermission("inventory.view")
  async ledger(@Query() q: { warehouseId?: string; sku?: string; type?: string; from?: string; to?: string; page?: string }) {
    return this.ops.ledger(q);
  }

  // ---------------- انتقال بین‌انباری ----------------

  @Get("transfers")
  @RequirePermission("inventory.view")
  async transfers(@Query() q: { state?: string; page?: string }) {
    return this.ops.listTransfers(q);
  }

  @Get("transfers/:id")
  @RequirePermission("inventory.view")
  async transfer(@Param("id") id: string) {
    return this.ops.getTransfer(id);
  }

  @Post("transfers")
  @RequirePermission("inventory.transfer")
  async createTransfer(@Req() req: Request, @Body() body: { fromWarehouseId: string; toWarehouseId: string; lines: Array<{ variantSku: string; qty: number }>; note?: string }) {
    return this.ops.createTransfer({ ...body, actorId: this.actor(req) });
  }

  @Post("transfers/:id/confirm")
  @RequirePermission("inventory.transfer")
  async confirmTransfer(@Req() req: Request, @Param("id") id: string) {
    return this.ops.confirmTransfer(id, this.actor(req));
  }

  @Post("transfers/:id/receive")
  @RequirePermission("inventory.transfer")
  async receiveTransfer(@Req() req: Request, @Param("id") id: string) {
    return this.ops.receiveTransfer(id, this.actor(req));
  }

  @Post("transfers/:id/cancel")
  @RequirePermission("inventory.transfer")
  async cancelTransfer(@Req() req: Request, @Param("id") id: string) {
    return this.ops.cancelTransfer(id, this.actor(req));
  }

  // ---------------- قرنطینه ----------------

  @Get("quarantine")
  @RequirePermission("inventory.view")
  async quarantine(@Query() q: { state?: string; page?: string }) {
    return this.ops.listQuarantine(q);
  }

  @Post("quarantine")
  @RequirePermission("inventory.quarantine")
  async quarantineHold(@Req() req: Request, @Body() body: { warehouseId: string; variantSku: string; qty: number; reason: string; refType?: string; refId?: string; note?: string }) {
    return this.ops.quarantineHold({ ...body, actorId: this.actor(req) });
  }

  @Post("quarantine/:id/release")
  @RequirePermission("inventory.quarantine")
  async quarantineRelease(@Req() req: Request, @Param("id") id: string, @Body() body: { note?: string }) {
    return this.ops.quarantineRelease(id, this.actor(req), body.note);
  }

  /** انهدام — DAMAGE از انبار + سند حسابداری خسارت */
  @Post("quarantine/:id/destroy")
  @RequirePermission("inventory.quarantine")
  async quarantineDestroy(@Req() req: Request, @Param("id") id: string, @Body() body: { note?: string }) {
    const result = await this.ops.quarantineDestroy(id, this.actor(req), body.note);
    if (result.value > 0) {
      await this.journal.post({
        description: "انهدام کالای قرنطینه — خسارت",
        sourceType: "damage",
        sourceId: result.damageRecordId,
        actorId: this.actor(req),
        lines: [
          { accountCode: "6000", debit: result.value },
          { accountCode: "1200", credit: result.value },
        ],
      }).catch(() => undefined); // سند هرگز عملیات انبار را برگردان نمی‌کند
    }
    return result;
  }

  // ---------------- خرابی / مفقودی ----------------

  @Get("damage")
  @RequirePermission("inventory.view")
  async damage(@Query() q: { state?: string; kind?: string; page?: string }) {
    return this.ops.listDamage(q);
  }

  @Post("damage")
  @RequirePermission("inventory.damage")
  async reportDamage(@Req() req: Request, @Body() body: { warehouseId: string; variantSku: string; qty: number; kind: "damage" | "loss"; reason?: string; holdForApproval?: boolean; note?: string }) {
    const rec = await this.ops.reportDamage({ ...body, actorId: this.actor(req) });
    if (rec.state === "POSTED" && rec.unitCost > 0n) {
      await this.journal.post({
        description: `${rec.kind === "loss" ? "مفقودی" : "خرابی"} ${rec.number}`,
        sourceType: "damage",
        sourceId: rec.id,
        actorId: this.actor(req),
        lines: [
          { accountCode: "6000", debit: Number(rec.unitCost * BigInt(rec.qty)) },
          { accountCode: "1200", credit: Number(rec.unitCost * BigInt(rec.qty)) },
        ],
      }).catch(() => undefined);
    }
    return rec;
  }

  @Post("damage/:id/post")
  @RequirePermission("inventory.damage")
  async postDamage(@Req() req: Request, @Param("id") id: string) {
    const rec = await this.ops.postDamage(id, this.actor(req));
    const after = await this.prisma.damageRecord.findUniqueOrThrow({ where: { id } });
    if (after.unitCost > 0n) {
      await this.journal.post({
        description: `${after.kind === "loss" ? "مفقودی" : "خرابی"} ${after.number}`,
        sourceType: "damage",
        sourceId: after.id,
        actorId: this.actor(req),
        lines: [
          { accountCode: "6000", debit: Number(after.unitCost * BigInt(after.qty)) },
          { accountCode: "1200", credit: Number(after.unitCost * BigInt(after.qty)) },
        ],
      }).catch(() => undefined);
    }
    return rec;
  }

  @Post("damage/:id/cancel")
  @RequirePermission("inventory.damage")
  async cancelDamage(@Req() req: Request, @Param("id") id: string) {
    return this.ops.cancelDamage(id, this.actor(req));
  }

  // ---------------- تنظیمات انبار ----------------

  @Get("settings")
  @RequirePermission("inventory.view")
  async getSettings() {
    return { items: await this.settings.getAll(), defs: INVENTORY_SETTINGS };
  }

  @Post("settings")
  @RequirePermission("inventory.settings")
  async setSetting(@Req() req: Request, @Body() body: { key: string; value: unknown }) {
    if (!body.key) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "کلید الزامی است." });
    await this.settings.set(body.key, body.value, this.actor(req));
    await this.prisma.auditLog.create({
      data: {
        actorId: this.actor(req) ?? null,
        action: "inventory.setting.update",
        entity: "InventorySetting",
        entityId: body.key,
        newValues: { value: body.value } as object,
      },
    }).catch(() => undefined);
    return { ok: true };
  }

  // ---------------- گزارش‌ها ----------------

  @Get("reports/valuation")
  @RequirePermission("inventory.reports")
  async valuation() {
    return this.reports.valuation();
  }

  @Get("reports/dead-stock")
  @RequirePermission("inventory.reports")
  async deadStock() {
    return this.reports.deadStock();
  }

  @Get("reports/fast-slow")
  @RequirePermission("inventory.reports")
  async fastSlow() {
    return this.reports.fastSlow();
  }

  @Get("reports/turnover")
  @RequirePermission("inventory.reports")
  async turnover() {
    return this.reports.turnover();
  }

  @Get("reports/adjustments")
  @RequirePermission("inventory.reports")
  async adjustments(@Query() q: { page?: string }) {
    return this.reports.adjustments(q);
  }

  @Get("reports/stocktake-variance")
  @RequirePermission("inventory.reports")
  async stocktakeVariance() {
    return this.reports.stocktakeVariance();
  }

  // ---------------- تایید انبارگردانی (Approval) ----------------

  /** اختلاف‌های بالای تحمل → ApprovalRequest؛ تایید → closeStocktake با bypass */
  @Post("stocktake/:id/request-approval")
  @RequirePermission("inventory.stocktake")
  async requestStocktakeApproval(@Req() req: Request, @Param("id") id: string) {
    const st = await this.prisma.stocktake.findUnique({ where: { id }, include: { items: true } });
    if (!st || st.state !== "OPEN") throw new BadRequestException({ code: "NOT_OPEN", message: "انبارگردانی بازی نیست." });
    const threshold = await this.settings.get<number>("adjustmentApprovalThreshold");
    const bigDiffs = st.items.filter((i) => i.countedQty != null && Math.abs((i.countedQty ?? 0) - i.systemQty) > threshold);
    if (bigDiffs.length === 0) return { approvalNeeded: false };
    const approval = await this.prisma.approvalRequest.create({
      data: {
        type: "stock_adjust",
        payload: {
          stocktakeId: st.id,
          number: st.number,
          tolerance: threshold,
          lines: bigDiffs.map((i) => ({ sku: i.variantSku, system: i.systemQty, counted: i.countedQty, diff: (i.countedQty ?? 0) - i.systemQty })),
        } as object,
        requestedById: this.actor(req) ?? "",
      },
    });
    await this.events.publish("StocktakeApprovalRequested", { stocktakeId: st.id, number: st.number, lines: bigDiffs.length });
    return { approvalNeeded: true, approvalId: approval.id, lines: bigDiffs.length };
  }

  /** لیست درخواست‌های تایید انبار (PENDING) — برای کارت تایید در UI */
  @Get("approvals")
  @RequirePermission("inventory.approve")
  async approvals() {
    const items = await this.prisma.approvalRequest.findMany({
      where: { type: "stock_adjust", state: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return { items };
  }

  /** تایید → فیلد approvedById پر می‌شود؛ سپس close با عبور از چک تحمل ممکن است */
  @Post("approvals/:id/decide")
  @RequirePermission("inventory.approve")
  async decideApproval(@Req() req: Request, @Param("id") id: string, @Body() body: { approve: boolean; note?: string }) {
    const apr = await this.prisma.approvalRequest.findUnique({ where: { id } });
    if (!apr || apr.state !== "PENDING") throw new BadRequestException({ code: "INVALID_STATE", message: "درخواست تایید یافت نشد/تصمیم قبلی ثبت شده." });
    if (apr.requestedById === this.actor(req)) {
      throw new BadRequestException({ code: "SELF_APPROVAL", message: "درخواست‌دهنده نمی‌تواند خودش تایید کند." });
    }
    const state = body.approve ? "APPROVED" : "REJECTED";
    await this.prisma.approvalRequest.update({
      where: { id },
      data: { state, decidedById: this.actor(req), decidedAt: new Date(), note: body.note },
    });
    const payload = apr.payload as { stocktakeId?: string; lines?: unknown[] };
    if (body.approve && payload.stocktakeId) {
      await this.prisma.stocktake.update({
        where: { id: payload.stocktakeId },
        data: { approvedById: this.actor(req), approvedAt: new Date(), toleranceQty: 999999 },
      });
    }
    await this.prisma.auditLog.create({
      data: {
        actorId: this.actor(req) ?? null,
        action: "inventory.approval.decide",
        entity: "ApprovalRequest",
        entityId: id,
        newValues: { state, note: body.note } as object,
      },
    }).catch(() => undefined);
    return { ok: true, state };
  }

}
