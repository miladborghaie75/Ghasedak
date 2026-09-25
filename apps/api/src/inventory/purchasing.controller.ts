import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Req } from "@nestjs/common";
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
    // سند حسابداری دریافت کالا — زنجیره بند ۴۷: GRN → Inventory → GRNI (کالای دریافتی، صورت‌حساب‌نشده)
    // Dr موجودی کالا (1200) / Cr GRNI (2150) — بدهی واقعی (AP) فقط با فاکتور باز می‌شود؛
    // این ساختار از دوبارشماری انبار/AP جلوگیری می‌کند و 1200 = ارزش واقعی موجودی می‌ماند.
    const total = grn.items.reduce((acc, i) => acc + Number(i.unitCost) * i.qty + Number(i.landedCost), 0);
    if (total > 0) {
      await this.journal.post({
        description: `دریافت کالا ${grn.number}`,
        sourceType: "purchase",
        sourceId: grn.id,
        actorId: this.actor(req),
        lines: [
          { accountCode: "1200", debit: total },
          { accountCode: "2150", credit: total },
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
    shippingTotal?: number; taxTotal?: number; discountTotal?: number; dueDate?: string; note?: string;
  }) {
    const result = await this.purchasing.createInvoice({ ...body, actorId: this.actor(req) });
    const invoice = result.invoice;
    // سند فاکتور — بند ۴۷/۴۸: بستن GRNI و باز کردن AP واقعی؛ اختلاف (حمل/تخفیف/PPV) به انبار می‌رود:
    // Dr GRNI (ارزش GRN) + [Dr 1200 اگر فاکتور بیشتر / Cr 1200 اگر کمتر] / Cr AP (جمع فاکتور)
    // → همیشه متوازن؛ GL AP = مانده AP زیرمجموعه؛ GL انبار = ارزش فاکتوری موجودی.
    const grnTotal = (await this.purchasing.getInvoiceDetail(invoice.id)).inventoryImpact.reduce((acc, i) => acc + Number(i.unitCost) * i.qty + Number(i.landedCost), 0);
    const grand = Number(invoice.grandTotal);
    if (grand > 0 || grnTotal > 0) {
      const diff = grand - grnTotal;
      const lines: Array<{ accountCode: string; debit?: number; credit?: number }> = [
        { accountCode: "2150", debit: grnTotal },
      ];
      if (diff > 0) lines.push({ accountCode: "1200", debit: diff });
      if (diff < 0) lines.push({ accountCode: "1200", credit: -diff });
      if (grand > 0) lines.push({ accountCode: "2100", credit: grand });
      await this.journal.post({
        description: `فاکتور خرید ${invoice.number}`,
        sourceType: "purchase_invoice",
        sourceId: invoice.id,
        actorId: this.actor(req),
        lines,
      }).catch(() => undefined);
    }
    return result;
  }

  /** جزئیات کامل فاکتور — صفحه حرفه‌ای بند ۲۷ (snapshot/lines/payments/AP/impact/audit) */
  @Get("purchase-invoices/:id/detail")
  @RequirePermission("purchasing.view")
  async invoiceDetail(@Param("id") id: string) {
    return this.purchasing.getInvoiceDetail(id);
  }

  @Post("purchase-invoices/:id/attachments")
  @RequirePermission("purchasing.manage")
  async addAttachment(@Req() req: Request, @Param("id") id: string, @Body() body: { mediaId: string; title?: string }) {
    if (!body.mediaId?.trim()) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "mediaId الزامی است." });
    }
    return this.purchasing.addAttachment(id, body.mediaId.trim(), body.title, this.actor(req));
  }

  @Delete("purchase-invoices/:id/attachments/:attachmentId")
  @RequirePermission("purchasing.manage")
  async removeAttachment(@Req() req: Request, @Param("attachmentId") attachmentId: string) {
    return this.purchasing.removeAttachment(attachmentId, this.actor(req));
  }

  @Post("purchase-invoices/:id/pay")
  @RequirePermission("purchasing.pay")
  async payInvoice(@Req() req: Request, @Param("id") id: string, @Body() body: { amount: number; method?: string; cashAccountId?: string }) {
    const result = await this.purchasing.payInvoice({ invoiceId: id, amount: body.amount, method: body.method, actorId: this.actor(req) });
    // سند حسابداری پرداخت — بند ۲۹: Dr AP / Cr نقد-بانک (روش تعیین‌کننده حساب است)
    const cashAccount = body.method === "cash" ? "1000" : "1100";
    await this.journal.post({
      description: `پرداخت فاکتور خرید — ${result.invoiceNumber}`,
      sourceType: "purchase_payment",
      sourceId: id,
      actorId: this.actor(req),
      lines: [
        { accountCode: "2100", debit: body.amount },
        { accountCode: cashAccount, credit: body.amount },
      ],
    }).catch(() => undefined);
    return result;
  }
}
