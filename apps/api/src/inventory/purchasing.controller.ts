import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { RequirePermission } from "../auth/permissions.guard";
import { PurchasingService } from "./purchasing.service";
import { JournalService } from "../accounting/journal.service";

/**
 * کنترلر خرید — Suppliers/PO/GRN/Invoice/Payments.
 * GRN → Ledger + WAC (auto)؛ Invoice → Three-way match + AP؛ Payment → تسویه AP.
 * سندهای حسابداری از JournalService با کد حساب استاندارد صادر می‌شوند.
 */
@Controller("admin/purchasing")
export class PurchasingController {
  constructor(
    private readonly purchasing: PurchasingService,
    private readonly journal: JournalService,
  ) {}

  private actor(req: Request): string | undefined {
    const id = (req as unknown as Record<string, unknown>).adminIdentity as { userId?: string } | undefined;
    return id?.userId;
  }

  // ---------------- تامین‌کننده ----------------

  @Get("suppliers")
  @RequirePermission("purchasing.view")
  async suppliers() {
    return this.purchasing.listSuppliers();
  }

  @Post("suppliers")
  @RequirePermission("purchasing.manage")
  async createSupplier(@Req() req: Request, @Body() body: { name: string; phone?: string; address?: string; taxId?: string; creditLimit?: number; notes?: string }) {
    return this.purchasing.createSupplier({ ...body, actorId: this.actor(req) });
  }

  @Post("suppliers/:id")
  @RequirePermission("purchasing.manage")
  async updateSupplier(@Req() req: Request, @Param("id") id: string, @Body() body: { name?: string; phone?: string; address?: string; taxId?: string; creditLimit?: number | null; notes?: string }) {
    return this.purchasing.updateSupplier(id, { ...body, actorId: this.actor(req) });
  }

  // ---------------- PO ----------------

  @Get("purchase-orders")
  @RequirePermission("purchasing.view")
  async purchaseOrders(@Query() q: { status?: string }) {
    return this.purchasing.listPOs(q);
  }

  @Get("purchase-orders/:id")
  @RequirePermission("purchasing.view")
  async purchaseOrder(@Param("id") id: string) {
    return this.purchasing.getPO(id);
  }

  @Post("purchase-orders")
  @RequirePermission("purchasing.manage")
  async createPO(@Req() req: Request, @Body() body: { supplierId: string; lines: Array<{ variantSku: string; qty: number; unitCost: number }>; note?: string }) {
    return this.purchasing.createPO({ ...body, actorId: this.actor(req) });
  }

  @Post("purchase-orders/:id/send")
  @RequirePermission("purchasing.manage")
  async sendPO(@Req() req: Request, @Param("id") id: string) {
    return this.purchasing.sendPO(id, this.actor(req));
  }

  @Post("purchase-orders/:id/cancel")
  @RequirePermission("purchasing.manage")
  async cancelPO(@Req() req: Request, @Param("id") id: string) {
    return this.purchasing.cancelPO(id, this.actor(req));
  }

  // ---------------- GRN ----------------

  @Get("goods-receipts")
  @RequirePermission("purchasing.view")
  async goodsReceipts() {
    return this.purchasing.listGRNs();
  }

  @Post("goods-receipts")
  @RequirePermission("purchasing.manage")
  async createGRN(@Req() req: Request, @Body() body: {
    supplierId: string; warehouseId: string; poId?: string;
    lines: Array<{ variantSku: string; qty: number; unitCost: number; landedCost?: number }>;
    note?: string;
  }) {
    const grn = await this.purchasing.createGRN({ ...body, actorId: this.actor(req) });
    // سند حسابداری خرید — بند ۴۴/۱۰۵: Dr موجودی کالا / Cr حساب‌های پرداختنی
    const total = grn.items.reduce((acc, i) => acc + Number(i.unitCost) * i.qty + Number(i.landedCost), 0);
    if (total > 0) {
      await this.journal.post({
        description: `دریافت کالا ${grn.number}`,
        sourceType: "purchase",
        sourceId: grn.id,
        actorId: this.actor(req),
        lines: [
          { accountCode: "1300", debit: total },
          { accountCode: "2100", credit: total },
        ],
      }).catch(() => undefined);
    }
    return grn;
  }

  // ---------------- Purchase Invoice + AP ----------------

  @Get("purchase-invoices")
  @RequirePermission("purchasing.view")
  async purchaseInvoices(@Query() q: { state?: string }) {
    return this.purchasing.listInvoices(q);
  }

  @Post("purchase-invoices")
  @RequirePermission("purchasing.manage")
  async createInvoice(@Req() req: Request, @Body() body: {
    supplierId: string; grnId: string; number?: string;
    lines: Array<{ variantSku: string; qty: number; unitCost: number }>;
    shippingTotal?: number; taxTotal?: number; dueDate?: string;
  }) {
    const result = await this.purchasing.createInvoice({ ...body, actorId: this.actor(req) });
    const invoice = result.invoice;
    if (invoice.grandTotal > 0n) {
      await this.journal.post({
        description: `فاکتور خرید ${invoice.number}`,
        sourceType: "purchase_invoice",
        sourceId: invoice.id,
        actorId: this.actor(req),
        lines: [
          { accountCode: "1300", debit: Number(invoice.grandTotal) },
          { accountCode: "2100", credit: Number(invoice.grandTotal) },
        ],
      }).catch(() => undefined);
    }
    return result;
  }

  @Post("purchase-invoices/:id/pay")
  @RequirePermission("purchasing.pay")
  async payInvoice(@Req() req: Request, @Param("id") id: string, @Body() body: { amount: number; method?: string }) {
    return this.purchasing.payInvoice({ invoiceId: id, amount: body.amount, method: body.method, actorId: this.actor(req) });
  }
}
