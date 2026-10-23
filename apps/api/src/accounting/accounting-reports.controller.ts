import { BadRequestException, Body, Controller, Get, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { JournalService } from "./journal.service";
import { CashFlowService } from "./cash-flow.service";
import { CSV_BOM, csvFilename, toCsv } from "./csv";
import { RequirePermission } from "../auth/permissions.guard";
import { Identity } from "../auth/identity.decorator";
import { optionalDate } from "../common/query-date";
import { GL, GL_EXPENSE, GL_LIABILITIES } from "@ghasedak/contracts";
import { AGING_BUCKET_LABELS, buildApAging } from "./ap-aging";

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
    private readonly cashFlowService: CashFlowService,
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

  /**
   * فاز ۱۱ (P3): ترازنامه — از همان JournalLine (بدون محاسبه موازی):
   * دارایی = Dr−Cr؛ بدهی/سرمایه = Cr−Dr؛ سود انباشته جاری = درآمد−بهای تمام‌شده−هزینه
   * (تا قبل از بستن حساب‌ها، توازن: دارایی = بدهی + سرمایه + سود جاری)
   */
  @Get("balance-sheet")
  @RequirePermission("accounting.reports")
  async balanceSheet(@Query() _q: Record<string, string>) {
    const accounts = await this.prisma.account.findMany();
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const lines = await this.prisma.journalLine.findMany({
      select: { accountId: true, debit: true, credit: true },
    });
    const nets: Record<string, bigint> = { ASSET: 0n, LIABILITY: 0n, EQUITY: 0n, REVENUE: 0n, COGS: 0n, EXPENSE: 0n };
    const perAccount = new Map<string, { code: string; name: string; net: bigint }>();
    for (const l of lines) {
      const a = byId.get(l.accountId);
      if (!a) continue;
      const net = a.type === "ASSET" || a.type === "COGS" || a.type === "EXPENSE"
        ? (l.debit ?? 0n) - (l.credit ?? 0n)
        : (l.credit ?? 0n) - (l.debit ?? 0n);
      nets[a.type] = (nets[a.type] ?? 0n) + net;
      if (a.type === "ASSET" || a.type === "LIABILITY" || a.type === "EQUITY") {
        const cur = perAccount.get(a.id) ?? { code: a.code, name: a.name, net: 0n };
        cur.net += net;
        perAccount.set(a.id, cur);
      }
    }
    const retained = (nets.REVENUE ?? 0n) - (nets.COGS ?? 0n) - (nets.EXPENSE ?? 0n);
    const assets = nets.ASSET ?? 0n;
    const liabilities = nets.LIABILITY ?? 0n;
    const equity = (nets.EQUITY ?? 0n) + retained;
    const detail = [...perAccount.values()]
      .map((x) => ({ code: x.code, name: x.name, net: x.net.toString() }))
      .sort((x, y) => x.code.localeCompare(y.code));
    return {
      assets: assets.toString(),
      liabilities: liabilities.toString(),
      equityBase: (nets.EQUITY ?? 0n).toString(),
      retainedEarnings: retained.toString(),
      equity: equity.toString(),
      balanced: assets === liabilities + equity,
      difference: (assets - (liabilities + equity)).toString(),
      detail,
    };
  }

  /**
   * فاز ۱۱ (P3): گردش حساب هر حساب در بازه — مانده ابتدای دوره، بدهکار/بستانکار دوره،
   * مانده پایان دوره؛ همه از JournalLine با فیلتر تاریخ سند.
   */
  @Get("account-turnover")
  @RequirePermission("accounting.reports")
  async accountTurnover(@Query() q: { from?: string; to?: string }) {
    const from = q.from ? new Date(q.from) : new Date(new Date().getFullYear(), 0, 1);
    const to = q.to ? new Date(q.to) : new Date();
    const accounts = await this.prisma.account.findMany({ orderBy: { code: "asc" } });
    const opening = await this.prisma.journalLine.groupBy({
      by: ["accountId"],
      where: { entry: { date: { lt: from } } },
      _sum: { debit: true, credit: true },
    });
    const period = await this.prisma.journalLine.groupBy({
      by: ["accountId"],
      where: { entry: { date: { gte: from, lte: to } } },
      _sum: { debit: true, credit: true },
    });
    const openMap = new Map(opening.map((o) => [o.accountId, o]));
    const periodMap = new Map(period.map((o) => [o.accountId, o]));
    const items = accounts.map((a) => {
      const o = openMap.get(a.id);
      const p = periodMap.get(a.id);
      const openDr = o?._sum.debit ?? 0n;
      const openCr = o?._sum.credit ?? 0n;
      const dr = p?._sum.debit ?? 0n;
      const cr = p?._sum.credit ?? 0n;
      const nature = a.type === "ASSET" || a.type === "COGS" || a.type === "EXPENSE" ? 1n : -1n;
      const openingNet = (openDr - openCr) * nature;
      const closingNet = openingNet + (dr - cr) * nature;
      return {
        code: a.code,
        name: a.name,
        type: a.type,
        opening: openingNet.toString(),
        debit: dr.toString(),
        credit: cr.toString(),
        closing: closingNet.toString(),
      };
    });
    return { from: from.toISOString(), to: to.toISOString(), items };
  }

  /**
   * صورت جریان نقدی — روش مستقیم با طبقه‌بندی عملیاتی/سرمایه‌ای/تأمین مالی.
   *
   * منطق در `CashFlowService` است (تست‌پذیر بدون HTTP)؛ اینجا فقط ورودی/خروجی.
   * گام ۱۲ (`[F1-2]`) سه نقص واقعی همین مسیر را رفع کرد: زیرحساب‌های بانک دیده
   * نمی‌شدند، سند `DRAFT` شمرده می‌شد، و طبقه‌بندی وجود نداشت.
   */
  @Get("cash-flow")
  @RequirePermission("accounting.reports")
  cashFlow(@Query() q: { from?: string; to?: string }) {
    return this.cashFlowService.statement(q.from, q.to);
  }

  /**
   * خروجی CSV گزارش‌های مالی (گام ۱۲ · `[F1-2]`).
   *
   * سه گزارش با همان منبع حقیقت endpointهای JSON: جریان نقدی، تراز آزمایشی،
   * سود و زیان. فایل با BOM و پایان‌خط ویندوزی صادر می‌شود تا Excel فارسی
   * درست باز کند؛ سلول‌های فرمول‌نما خنثی می‌شوند (`csv.ts`).
   */
  @Get("export/:report")
  @RequirePermission("accounting.reports")
  async exportReport(
    @Param("report") report: string,
    @Query() q: { from?: string; to?: string },
    @Res() res: Response,
  ): Promise<void> {
    // بازه از خودِ گزارش خوانده می‌شود (نه از query خام): وقتی کاربر بازه
    // نداده، گزارش بازهٔ واقعی خودش را می‌داند و نام فایل همان را نشان می‌دهد.
    const { rows, from, to } = await this.buildExport(report, q);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="${csvFilename(report, from, to)}"`);
    res.send(CSV_BOM + toCsv(rows));
  }

  private async buildExport(
    report: string,
    q: { from?: string; to?: string },
  ): Promise<{ rows: Array<Array<string | number | null>>; from: Date | null; to: Date | null }> {
    if (report === "cash-flow") {
      const cf = await this.cashFlowService.statement(q.from, q.to);
      const rows: Array<Array<string | number | null>> = [
        ["ردیف", "کد", "مبلغ"],
        ["مانده ابتدای دوره", "OPENING", cf.opening],
        ["جریان عملیاتی", "OPERATING", cf.classes.OPERATING.net],
        ["جریان سرمایه‌ای", "INVESTING", cf.classes.INVESTING.net],
        ["جریان تأمین مالی", "FINANCING", cf.classes.FINANCING.net],
        ["طبقه‌بندی‌نشده", "UNCLASSIFIED", cf.classes.UNCLASSIFIED.net],
        ["خالص تغییر نقدی", "NET", cf.net],
        ["مانده پایان دوره", "CLOSING", cf.closing],
        ["انتقال داخلی — تعداد", "INTERNAL_COUNT", cf.internalTransfers.count],
        ["انتقال داخلی — مبلغ ناخالص (در جمع نیامده)", "INTERNAL_GROSS", cf.internalTransfers.gross],
      ];
      return { rows, from: new Date(cf.from), to: new Date(cf.to) };
    }

    if (report === "trial-balance") {
      const tb = await this.journal.trialBalance(optionalDate(q.from, "from"), optionalDate(q.to, "to"));
      const rows: Array<Array<string | number | null>> = [
        ["کد حساب", "نام حساب", "نوع", "بدهکار", "بستانکار"],
        ...tb.items.map((r) => [r.code, r.name, r.type, r.debit, r.credit]),
        ["جمع", "", "", tb.totals.debit, tb.totals.credit],
      ];
      return { rows, from: tb.from ? new Date(tb.from) : null, to: tb.to ? new Date(tb.to) : null };
    }

    if (report === "pnl") {
      const p = await this.pnl(q);
      const rows: Array<Array<string | number | null>> = [
        ["شرح", "مبلغ"],
        ["درآمد", p.revenue],
        ["بهای تمام‌شده", p.cogs],
        ["سود ناخالص", p.grossProfit],
        ["هزینه‌ها", p.expenses],
        ["سود خالص", p.netProfit],
        ["حاشیهٔ ناخالص (٪)", p.grossMargin ?? ""],
        ["حاشیهٔ خالص (٪)", p.netMargin ?? ""],
      ];
      // سود و زیان همیشه یک بازه دارد (پیش‌فرض از ابتدای سال)
      return { rows, from: new Date(p.from), to: new Date(p.to) };
    }

    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "گزارش ناشناخته برای خروجی (cash-flow | trial-balance | pnl)",
    });
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
  /**
   * فاکتورهای خرید برای گزارش.
   *
   * نگاشت دستی لازم است: رکورد خام Prisma فیلد `BigInt` دارد و `JSON.stringify`
   * روی BigInt خطا می‌دهد — یعنی این endpoint قبلاً عملاً همیشه ۵۰۰ می‌داد
   * و به همین دلیل در UI به‌جایش متن ثابت نمایش داده می‌شد.
   */
  @Get("purchase-invoices")
  @RequirePermission("accounting.view")
  async purchaseInvoices() {
    const rows = await this.prisma.purchaseInvoice
      .findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { supplier: { select: { name: true } } },
      })
      .catch(() => []);
    const items = rows.map((p) => ({
      number: p.number,
      party: p.supplier?.name ?? "—",
      total: Number(p.grandTotal ?? 0).toString(),
      status: p.state,
      createdAt: p.createdAt.toISOString(),
    }));
    return { items, total: items.length };
  }

  /**
   * گزارش سن بدهی (AP aging) — گام ۱۸.
   *
   * منبع حقیقت: AccountsPayable تسویه‌نشده (state ≠ SETTLED)؛ مانده هر ردیف
   * = amount − paidAmount (بدون محاسبه موازی). سبد از سررسید؛ نبودِ سررسید
   * یعنی سبد «جاری» از تاریخ ثبت. فقط فاکتورهای خرید (refType=purchase_invoice).
   */
  @Get("ap-aging")
  @RequirePermission("accounting.reports")
  async apAging() {
    const aps = await this.prisma.accountsPayable.findMany({
      where: { state: { not: "SETTLED" }, refType: "purchase_invoice" },
      orderBy: { createdAt: "asc" },
      include: { supplierAccount: { select: { supplierId: true } } },
    });
    const supplierIds = [...new Set(aps.map((a) => a.supplierAccount.supplierId))];
    const suppliers = await this.prisma.supplier.findMany({
      where: { id: { in: supplierIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(suppliers.map((s) => [s.id, s.name]));
    const report = buildApAging(
      aps.map((a) => ({
        supplierId: a.supplierAccount.supplierId,
        supplierName: nameById.get(a.supplierAccount.supplierId) ?? "—",
        refType: a.refType,
        remaining: a.amount - a.paidAmount,
        dueDate: a.dueDate,
        fallbackDate: a.createdAt,
      })),
      new Date(),
    );
    return { ...report, bucketLabels: AGING_BUCKET_LABELS };
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
        { accountCode: GL_EXPENSE.OPERATING, debit: body.amount },
        { accountCode: GL_LIABILITIES.PAYABLE, credit: body.amount },
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
