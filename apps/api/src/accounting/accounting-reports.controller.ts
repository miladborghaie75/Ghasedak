import { BadRequestException, Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JournalService } from "./journal.service";
import { RequirePermission } from "../auth/permissions.guard";
import { Identity } from "../auth/identity.decorator";

/**
 * گزارش‌ها و عملیات گسترده حسابداری — بند ۲۴/۳۱/۱۰۶:
 * سود ناخالص/خالص، فاکتورهای فروش/خرید، حقوق و دستمزد، دفتر چارت.
 * همه محاسبه از منبع حقیقت (JournalLine/Ledger).
 */
@Controller("admin/accounting")
export class AccountingReportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: JournalService,
  ) {}

  /** سود و زیان — ناخالص (فروش − COGS) و خالص (− هزینه‌ها) از اسناد واقعی */
  @Get("pnl")
  @RequirePermission("accounting.reports")
  async pnl(@Query() q: { from?: string; to?: string }) {
    const from = q.from ? new Date(q.from) : new Date(new Date().getFullYear(), 0, 1);
    const to = q.to ? new Date(q.to) : new Date();
    const accounts = await this.prisma.account.findMany();
    const byType = new Map(accounts.map((a) => [a.id, a.type]));

    const lines = await this.prisma.journalLine.findMany({
      where: { entry: { date: { gte: from, lte: to } } },
      select: { accountId: true, debit: true, credit: true },
    });
    const totals: Record<string, bigint> = { REVENUE: 0n, COGS: 0n, EXPENSE: 0n, ASSET: 0n, LIABILITY: 0n, EQUITY: 0n };
    for (const l of lines) {
      const t = byType.get(l.accountId);
      if (!t) continue;
      const net = (t === "REVENUE" ? (l.credit ?? 0n) - (l.debit ?? 0n) : (l.debit ?? 0n) - (l.credit ?? 0n));
      totals[t] = (totals[t] ?? 0n) + net;
    }
    const revenue = totals.REVENUE ?? 0n;
    const cogs = totals.COGS ?? 0n;
    const expense = totals.EXPENSE ?? 0n;
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      revenue: revenue.toString(),
      cogs: cogs.toString(),
      grossProfit: (revenue - cogs).toString(),
      expenses: expense.toString(),
      netProfit: (revenue - cogs - expense).toString(),
      grossMargin: revenue > 0n ? Number(((revenue - cogs) * 100n) / revenue) : null,
      netMargin: revenue > 0n ? Number(((revenue - cogs - expense) * 100n) / revenue) : null,
    };
  }

  /** روند ماهانه درآمد/هزینه — برای نمودار داشبورد */
  @Get("monthly")
  @RequirePermission("accounting.reports")
  async monthly() {
    const accounts = await this.prisma.account.findMany();
    const byType = new Map(accounts.map((a) => [a.id, a.type]));
    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const lines = await this.prisma.journalLine.findMany({
      where: { entry: { date: { gte: yearStart } } },
      select: { accountId: true, debit: true, credit: true, entry: { select: { date: true } } },
    });
    const months: Array<{ month: number; revenue: string; expense: string }> = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1, revenue: "0", expense: "0",
    }));
    const acc = months.map((m) => ({ ...m, rev: 0n, exp: 0n }));
    for (const l of lines) {
      const t = byType.get(l.accountId);
      if (!t || (t !== "REVENUE" && t !== "EXPENSE" && t !== "COGS")) continue;
      const m = l.entry.date.getMonth();
      if (t === "REVENUE") acc[m].rev += (l.credit ?? 0n) - (l.debit ?? 0n);
      else acc[m].exp += (l.debit ?? 0n) - (l.credit ?? 0n);
    }
    return acc.map((m) => ({ month: m.month, revenue: m.rev.toString(), expense: m.exp.toString() }));
  }

  /** فاکتورهای فروش (سفارش آنلاین + POS نهایی) */
  @Get("sales-invoices")
  @RequirePermission("accounting.view")
  async salesInvoices(@Query() q: { page?: string }) {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = 20;
    const [online, pos, onlineTotal, posTotal] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where: { paymentStatus: "PAID" },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit, take: limit,
        select: { code: true, total: true, guestName: true, createdAt: true, channel: { select: { name: true } } },
      }),
      this.prisma.posInvoice.findMany({
        where: { state: "FINALIZED" },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit, take: limit,
        select: { number: true, grandTotal: true, customerName: true, createdAt: true, channel: { select: { name: true } } },
      }),
      this.prisma.order.count({ where: { paymentStatus: "PAID" } }),
      this.prisma.posInvoice.count({ where: { state: "FINALIZED" } }),
    ]);
    return {
      items: [
        ...online.map((o) => ({ number: o.code, total: o.total, party: o.guestName ?? "مهمان", channel: o.channel?.name ?? "—", kind: "ONLINE" as const, createdAt: o.createdAt })),
        ...pos.map((p) => ({ number: p.number, total: p.grandTotal, party: p.customerName ?? "حضوری", channel: p.channel?.name ?? "—", kind: "POS" as const, createdAt: p.createdAt })),
      ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit),
      total: onlineTotal + posTotal,
      page,
      limit,
    };
  }

  /** فاکتورهای خرید — از PurchaseInvoice (شِما آماده؛ تا راه‌اندازی ماژول خرید، خالی صادقانه) */
  @Get("purchase-invoices")
  @RequirePermission("accounting.view")
  async purchaseInvoices() {
    const items = await this.prisma.purchaseInvoice.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { supplier: { select: { name: true } } },
    }).catch(() => []);
    return { items, total: items.length };
  }

  /** ثبت حقوق و دستمزد — سند اتوماتیک Dr هزینه حقوق / Cr بدهکاران (بند ۲۵) */
  @Post("payroll")
  @RequirePermission("accounting.journal")
  async payroll(
    @Body() body: { title: string; amount: number; employeeName?: string },
    @Identity() actor?: { userId: string },
  ) {
    if (!Number.isSafeInteger(body.amount) || body.amount <= 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "مبلغ نامعتبر است." });
    }
    const desc = body.employeeName ? `حقوق ${body.employeeName} — ${body.title}` : body.title;
    const entry = await this.journal.post({
      description: desc,
      sourceType: "payroll",
      actorId: actor?.userId,
      lines: [
        { accountCode: "6000", debit: body.amount },
        { accountCode: "2100", credit: body.amount },
      ],
    });
    return entry;
  }

  /** دفتر چارت (حساب‌ها) */
  @Get("accounts")
  @RequirePermission("accounting.view")
  async accounts() {
    const rows = await this.prisma.account.findMany({ orderBy: { code: "asc" } });
    return { items: rows };
  }

  /** اسناد روزانه */
  @Get("entries")
  @RequirePermission("accounting.view")
  async entries(@Query() q: { page?: string }) {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = 20;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.journalEntry.findMany({
        orderBy: { date: "desc" },
        skip: (page - 1) * limit, take: limit,
        include: { lines: { include: { account: { select: { code: true, name: true } } } } },
      }),
      this.prisma.journalEntry.count(),
    ]);
    return { items, total, page, limit };
  }

  /** سند معکوس (اصلاحیه) — بند ۲۶: اسناد نهایی هرگز edit نمی‌شوند */
  @Post("entries/:id/reverse")
  @RequirePermission("accounting.journal")
  async reverse(@Param("id") id: string, @Identity() actor?: { userId: string }) {
    const entry = await this.prisma.journalEntry.findUnique({ where: { id }, include: { lines: true } });
    if (!entry) throw new BadRequestException({ code: "NOT_FOUND", message: "سند یافت نشد." });
    const accounts = await this.prisma.account.findMany();
    const byId = new Map(accounts.map((a) => [a.id, a.code]));
    const reversed = entry.lines.map((l) => ({
      accountCode: byId.get(l.accountId)!,
      debit: Number(l.credit),
      credit: Number(l.debit),
    }));
    return this.journal.post({
      description: `سند معکوس ${entry.number} — ${entry.description ?? ""}`.trim(),
      sourceType: "reversal",
      sourceId: entry.id,
      actorId: actor?.userId,
      lines: reversed,
    });
  }
}

void Query;
