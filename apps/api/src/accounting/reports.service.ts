import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * گزارش‌های فاز ۵ — همه از `JournalLine` (منبع حقیقت) یا از جدول‌های
 * دسته‌بندی‌شدهٔ مالی که **خودشان** از دفتر مشتق شده‌اند.
 *
 * اصل حاکم: هیچ گزارشی نباید عددی را از جایی غیر از دفتر کل بیاورد.
 * اگر یک گزارش با تراز آزمایشی نخواند، یعنی جایی در ثبت سند ایراد است —
 * و باید **سند** پیدا شود، نه اینکه گزارش دستی درست شود.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** خلاصهٔ سود و زیان فقط از اسناد قطعی دفتر کل؛ برای پاسخ‌گویی مدیریتی و تطبیق با گزارش P&L. */
  async profitAndLoss(from?: string, to?: string) {
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (from) {
      const start = new Date(from);
      if (!Number.isFinite(start.getTime())) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "تاریخ شروع نامعتبر است." });
      dateFilter.gte = start;
    }
    if (to) {
      const end = new Date(`${to}T23:59:59.999Z`);
      if (!Number.isFinite(end.getTime())) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "تاریخ پایان نامعتبر است." });
      dateFilter.lte = end;
    }
    if (dateFilter.gte && dateFilter.lte && dateFilter.gte > dateFilter.lte) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "تاریخ شروع بعد از تاریخ پایان است." });
    }
    const [accounts, rows] = await Promise.all([
      this.prisma.account.findMany({ select: { id: true, type: true } }),
      this.prisma.journalLine.groupBy({
        by: ["accountId"],
        where: { entry: { state: "FINAL", ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}) } },
        _sum: { debit: true, credit: true },
      }),
    ]);
    const typeById = new Map(accounts.map((a) => [a.id, a.type]));
    const totals = { revenue: 0n, cogs: 0n, expenses: 0n };
    for (const row of rows) {
      const type = typeById.get(row.accountId);
      if (type !== "REVENUE" && type !== "COGS" && type !== "EXPENSE") continue;
      const debit = row._sum.debit ?? 0n;
      const credit = row._sum.credit ?? 0n;
      totals[type === "REVENUE" ? "revenue" : type === "COGS" ? "cogs" : "expenses"] +=
        type === "REVENUE" ? credit - debit : debit - credit;
    }
    return {
      from: from ?? null,
      to: to ?? null,
      revenue: totals.revenue.toString(),
      cogs: totals.cogs.toString(),
      grossProfit: (totals.revenue - totals.cogs).toString(),
      expenses: totals.expenses.toString(),
      netProfit: (totals.revenue - totals.cogs - totals.expenses).toString(),
    };
  }

  /**
   * حساب‌های دریافتنی و پرداختنی + **سنی بدهکاران**.
   *
   * چرا از جدول‌های AR/AP و نه از `1200/1210/2100/2150`: بدهی فقط وقتی
   * بدهی است که **سررسید** داشته باشد — یعنی در فروش اعتباری ثبت شده باشد.
   * حساب کل بدهی در دفتر فقط مبلغ را می‌گوید، نه اینکه چه کسی و تا کی.
   *
   * گروه‌های سنی بر حسب روز تا سررسید: جاری / ۱–۳۰ / ۳۱–۶۰ / ۶۱–۹۰ / ۹۰+
   */
  async receivablesPayables(asOf?: string) {
    const at = asOf ? new Date(asOf) : new Date();
    const DAY = 86_400_000;

    // مدل `CustomerAccount`/`SupplierAccount` رابطهٔ Prisma ندارد (فقط
    // `customerId`/`supplierId` دارد)، پس نام طرف حساب جدا کوئری می‌شود تا
    // گزارش بدون join و بدون حدس کار کند.
    const [ar, ap, customers, suppliers] = await Promise.all([
      this.prisma.accountsReceivable.findMany({
        where: { state: { in: ["OPEN", "PARTIAL"] } },
        include: {
          customerAccount: { select: { customerId: true } },
          checks: { select: { id: true, number: true, dueDate: true, amount: true, status: true } },
        },
        orderBy: { dueDate: "asc" },
        take: 1000,
      }),
      this.prisma.accountsPayable.findMany({
        where: { state: { in: ["OPEN", "PARTIAL"] } },
        include: { supplierAccount: { select: { supplierId: true } } },
        orderBy: { dueDate: "asc" },
        take: 1000,
      }),
      this.prisma.customerAccount.findMany({ select: { customerId: true } }),
      this.prisma.supplierAccount.findMany({ select: { supplierId: true } }),
    ]);

    const arCustomerIds = [...new Set(ar.map((r) => r.customerAccount?.customerId).filter(Boolean))] as string[];
    const apSupplierIds = [...new Set(ap.map((r) => r.supplierAccount?.supplierId).filter(Boolean))] as string[];
    const customerRows = arCustomerIds.length
      ? await this.prisma.customer.findMany({
          where: { id: { in: arCustomerIds } },
          select: { id: true, name: true, mobile: true },
        })
      : [];
    const supplierRows = apSupplierIds.length
      ? await this.prisma.supplier.findMany({ where: { id: { in: apSupplierIds } }, select: { id: true, name: true } })
      : [];
    const customerById = new Map(customerRows.map((c) => [c.id, c]));
    const supplierById = new Map(supplierRows.map((s) => [s.id, s]));
    void customers;
    void suppliers;

    /** گروه سنی از روی سررسید — بدون سررسید یعنی «سررسید ندارد» نه «سررسید گذشته» */
    const bucket = (due: Date | null): string => {
      if (!due) return "بدون سررسید";
      const days = Math.floor((at.getTime() - due.getTime()) / DAY);
      if (days < 0) return "سررسید نشده";
      if (days === 0) return "جاری";
      if (days <= 30) return "۱ تا ۳۰ روز گذشته";
      if (days <= 60) return "۳۱ تا ۶۰ روز گذشته";
      if (days <= 90) return "۶۱ تا ۹۰ روز گذشته";
      return "بیش از ۹۰ روز گذشته";
    };

    const arRows = ar.map((r) => {
      const open = Number(r.amount) - Number(r.paidAmount);
      const daysLate = r.dueDate ? Math.floor((at.getTime() - new Date(r.dueDate).getTime()) / DAY) : null;
      const customerId = r.customerAccount?.customerId ?? null;
      const cust = customerId ? customerById.get(customerId) : null;
      return {
        id: r.id,
        partyId: customerId,
        party: cust?.name ?? "—",
        mobile: cust?.mobile ?? null,
        refType: r.refType,
        refId: r.refId,
        amount: Number(r.amount),
        paid: Number(r.paidAmount),
        open,
        dueDate: r.dueDate?.toISOString() ?? null,
        bucket: bucket(r.dueDate),
        daysLate: daysLate != null && daysLate > 0 ? daysLate : 0,
        overdue: daysLate != null && daysLate > 0,
        state: r.state,
        checkCount: r.checks.length,
      };
    });

    const apRows = ap.map((r) => {
      const open = Number(r.amount) - Number(r.paidAmount);
      const daysLate = r.dueDate ? Math.floor((at.getTime() - new Date(r.dueDate).getTime()) / DAY) : null;
      const supplierId = r.supplierAccount?.supplierId ?? null;
      return {
        id: r.id,
        partyId: supplierId,
        party: (supplierId ? supplierById.get(supplierId)?.name : null) ?? "—",
        refType: r.refType,
        refId: r.refId,
        amount: Number(r.amount),
        paid: Number(r.paidAmount),
        open,
        dueDate: r.dueDate?.toISOString() ?? null,
        bucket: bucket(r.dueDate),
        daysLate: daysLate != null && daysLate > 0 ? daysLate : 0,
        overdue: daysLate != null && daysLate > 0,
        state: r.state,
      };
    });

    // تابع عمومی: فقط `bucket` و `open` لازم دارد، پس نوع کامل مهم نیست
    const sum = (rows: Array<{ open: number }>, key: "open") => rows.reduce((s, r) => s + r[key], 0);
    const byBucket = (rows: Array<{ bucket: string; open: number }>) => {
      const m: Record<string, number> = {};
      for (const r of rows) m[r.bucket] = (m[r.bucket] ?? 0) + r.open;
      return m;
    };

    return {
      asOf: at.toISOString(),
      receivables: {
        total: sum(arRows, "open"),
        count: arRows.length,
        overdueTotal: arRows.filter((r) => r.overdue).reduce((s, r) => s + r.open, 0),
        byBucket: byBucket(arRows),
        items: arRows,
      },
      payables: {
        total: sum(apRows, "open"),
        count: apRows.length,
        overdueTotal: apRows.filter((r) => r.overdue).reduce((s, r) => s + r.open, 0),
        byBucket: byBucket(apRows),
        items: apRows,
      },
      // بدهی خالص = آنچه ما طلب داریم منهای آنچه بدهکاریم
      net: sum(arRows, "open") - sum(apRows, "open"),
    };
  }

  /**
   * سودآوری هر کالا و هر دسته.
   *
   * برای اینکه سود واقعی باشد، باید **بهای تمام‌شده** را کم کنیم. بها از
   * سندهای COGS می‌آید (`5000` بستانکار در زمان فروش) و به محصول وصل است
   * چون `OrderItem`/`PosInvoiceItem` به واریانت اشاره دارد.
   *
   * اگر بها صفر باشد (محصول `costPrice` نداشته) گزارش باید **صادقانه**
   * بگوید «بها نامشخص» به‌جای اینکه سود را کامل نشان دهد — سود بدون بها
   * گمراه‌کننده‌ترین عددی است که می‌شود گزارش داد.
   */
  async productProfitability(from?: string, to?: string) {
    const where = this.rangeWhere(from, to);
    const since = from ? new Date(from) : null;
    const until = to ? new Date(to) : null;
    const inRange = (d: Date | null | undefined) => {
      if (!d) return false;
      if (since && d < since) return false;
      if (until && d > until) return false;
      return true;
    };

    const [orders, posInvoices, saleReturns] = await Promise.all([
      this.prisma.orderItem.findMany({
        // `Order` فیلد `date` ندارد؛ تاریخ سفارش همان `createdAt` است
        where: { order: { paymentStatus: "PAID", ...(where.date ? { createdAt: where.date } : {}) } },
        include: {
          order: { select: { createdAt: true } },
          variant: { select: { sku: true, product: { select: { id: true, name: true, category: { select: { id: true, name: true } } } } } },
        },
        take: 20000,
      }),
      this.prisma.posInvoiceItem.findMany({
        where: { invoice: { state: "FINALIZED", ...(where.date ? { createdAt: where.date } : {}) } },
        include: { invoice: { select: { createdAt: true } }, variant: { select: { sku: true, product: { select: { id: true, name: true, category: { select: { id: true, name: true } } } } } } },
        take: 20000,
      }),
      // `Refund` فیلد `date` ندارد (فقط `createdAt`) و رابطهٔ `order` هم ندارد؛
      // مرجعش `sourceType/sourceId` است. ردیف‌های سفارش در کوئری بالا می‌آید.
      this.prisma.refund.findMany({
        where: { state: "COMPLETED", ...(where.date ? { createdAt: where.date } : {}) },
        select: { id: true, sourceType: true, sourceId: true, amount: true, createdAt: true },
        take: 5000,
      }),
    ]);

    type Row = {
      productId: string;
      name: string;
      categoryId: string;
      categoryName: string;
      qty: number;
      revenue: number;
      cogs: number;
      costKnown: boolean;
    };
    const map = new Map<string, Row>();

    const touch = (
      productId: string,
      name: string,
      categoryId: string,
      categoryName: string,
    ): Row => {
      let r = map.get(productId);
      if (!r) {
        r = { productId, name, categoryId, categoryName, qty: 0, revenue: 0, cogs: 0, costKnown: true };
        map.set(productId, r);
      }
      return r;
    };

    // ── فروش آنلاین ──
    for (const it of orders) {
      if (!inRange(it.order?.createdAt)) continue;
      const p = it.variant?.product;
      if (!p) continue;
      const r = touch(p.id, p.name, p.category?.id ?? "-", p.category?.name ?? "بدون دسته");
      r.qty += it.qty;
      r.revenue += Number(it.lineTotal);
    }

    // ── فروش حضوری ──
    for (const it of posInvoices) {
      if (!inRange(it.invoice?.createdAt)) continue;
      const p = it.variant?.product;
      if (!p) continue;
      const r = touch(p.id, p.name, p.category?.id ?? "-", p.category?.name ?? "بدون دسته");
      r.qty += it.qty;
      r.revenue += Number(it.lineTotal);
    }

    // ردیف‌های سفارش برای تسهیم برگشت — جدا، چون `orderItem` خودش یک ردیف است
    const refundOrderIds = [...new Set(saleReturns.map((r) => r.sourceId))].filter(Boolean);
    const refundOrderItems = refundOrderIds.length
      ? await this.prisma.orderItem.findMany({
          where: { orderId: { in: refundOrderIds } },
          select: {
            orderId: true,
            lineTotal: true,
            variant: { select: { product: { select: { id: true, name: true, category: { select: { id: true, name: true } } } } } },
          },
        })
      : [];
    const refundItemsByOrder = new Map<string, typeof refundOrderItems>();
    for (const it of refundOrderItems) {
      const list = refundItemsByOrder.get(it.orderId) ?? [];
      list.push(it);
      refundItemsByOrder.set(it.orderId, list);
    }

    // ── برگشت از فروش (کاهش درآمد) ──
    for (const rf of saleReturns) {
      if (!inRange(rf.createdAt)) continue;
      if (rf.sourceType !== "order") continue;
      const orderItems = refundItemsByOrder.get(rf.sourceId);
      if (!orderItems?.length) continue;
      const total = orderItems.reduce((s: number, i: { lineTotal: bigint }) => s + Number(i.lineTotal), 0);
      if (total <= 0) continue;
      // برگشت مبلغ است ⇒ به نسبت قیمت هر ردیف بین کالاها پخش می‌شود
      for (const li of orderItems) {
        const p = li.variant?.product;
        if (!p) continue;
        const share = Number(li.lineTotal) / total;
        const r = touch(p.id, p.name, p.category?.id ?? "-", p.category?.name ?? "بدون دسته");
        r.revenue -= Math.round(Number(rf.amount ?? 0) * share);
      }
    }

    // ── بهای تمام‌شده از سندهای COGS ──
    // **نکتهٔ مهم (فاز ۷):** سند فروش آنلاین `sourceType: "order"` است ولی
    // فروش حضوری `pos_invoice`. پیش‌تر فقط `order:` خوانده می‌شد، پس بهای
    // تمام‌شدهٔ **کل فروش حضوری** هرگز وارد گزارش نمی‌شد و سود آن کالا
    // همیشه «قابل اتکا نیست» می‌ماند — یعنی سود واقعی صندوق قابل گزارش نبود.
    //
    // حالا هر دو نوع فروش پوشش داده می‌شوند و اگر سندی هر دو کانال داشته باشد
    // جمع‌شان می‌شود (که درست است چون بهای هر دو فروش باید کسر شود).
    const cogsLines = await this.prisma.journalLine.findMany({
      where: { account: { code: { in: ["5000", "5000-01", "5000-02", "5000-03"] } }, debit: { gt: 0n }, ...(where.date ? { entry: { state: "FINAL", date: where.date } } : { entry: { state: "FINAL" } }) },
      include: { entry: { select: { sourceType: true, sourceId: true, date: true } } },
      take: 20000,
    });

    /** کلید مرجع = هرچه شناسهٔ منبع سند است (سفارش آنلاین یا فاکتور حضوری) */
    const cogsByRef = new Map<string, number>();
    for (const l of cogsLines) {
      const k = l.entry.sourceId ?? "";
      if (!k) continue;
      cogsByRef.set(k, (cogsByRef.get(k) ?? 0) + Number(l.debit));
    }

    // فروش آنلاین
    for (const it of orders) {
      if (!inRange(it.order?.createdAt) || !it.variant?.product) continue;
      const r = map.get(it.variant.product.id);
      if (!r) continue;
      r.cogs += cogsByRef.get(it.orderId) ?? 0;
    }

    // فروش حضوری
    for (const it of posInvoices) {
      if (!inRange(it.invoice?.createdAt) || !it.variant?.product) continue;
      const r = map.get(it.variant.product.id);
      if (!r) continue;
      r.cogs += cogsByRef.get(it.invoiceId) ?? 0;
    }

    // اگر سند COGS برای فروش آن کالا نبود ⇒ بها نامشخص است
    const withCogs = new Set<string>();
    for (const it of orders) {
      if (cogsByRef.has(it.orderId) && it.variant?.product) withCogs.add(it.variant.product.id);
    }
    for (const it of posInvoices) {
      if (cogsByRef.has(it.invoiceId) && it.variant?.product) withCogs.add(it.variant.product.id);
    }
    for (const r of map.values()) {
      if (r.cogs === 0 && !withCogs.has(r.productId) && r.revenue > 0) r.costKnown = false;
    }

    const products = [...map.values()]
      .map((r) => ({ ...r, profit: r.costKnown ? r.revenue - r.cogs : null, margin: r.costKnown && r.revenue > 0 ? (r.revenue - r.cogs) / r.revenue : null }))
      .filter((r) => r.revenue !== 0 || r.qty !== 0)
      .sort((a, b) => (b.profit ?? b.revenue) - (a.profit ?? a.revenue));

    // ── تجمیع بر اساس دسته ──
    const catMap = new Map<string, { categoryId: string; name: string; qty: number; revenue: number; cogs: number }>();
    for (const p of products) {
      let c = catMap.get(p.categoryId);
      if (!c) {
        c = { categoryId: p.categoryId, name: p.categoryName, qty: 0, revenue: 0, cogs: 0 };
        catMap.set(p.categoryId, c);
      }
      c.qty += p.qty;
      c.revenue += p.revenue;
      c.cogs += p.cogs;
    }
    const categories = [...catMap.values()]
      .map((c) => ({ ...c, profit: c.revenue - c.cogs, margin: c.revenue > 0 ? (c.revenue - c.cogs) / c.revenue : null }))
      .sort((a, b) => b.revenue - a.revenue);

    return {
      range: { from: from ?? null, to: to ?? null },
      totals: {
        qty: products.reduce((s, p) => s + p.qty, 0),
        revenue: products.reduce((s, p) => s + p.revenue, 0),
        cogs: products.reduce((s, p) => s + p.cogs, 0),
        /** کالاهایی که بهایشان معلوم نیست — سودشان قابل اتکا نیست */
        unknownCostCount: products.filter((p) => !p.costKnown).length,
      },
      products,
      categories,
    };
  }

  /**
   * مغایرت بانکی برای **همهٔ** حساب‌های بانکی.
   *
   * گزارل قبلی فقط یک حساب را می‌داد و آن هم از طریق `treasury` بود؛
   * حالا همهٔ زیرحساب‌های `1100-xx` جدا گزارش می‌شوند — وگرنه با
   * ۳ بانک، مغایرت‌ها قاطی هم می‌شدند.
   */
  async bankReconciliation() {
    const banks = await this.prisma.bankAccount.findMany({
      where: { active: true },
      include: { account: { select: { code: true, name: true } } },
      orderBy: { name: "asc" },
    });

    const rows = await Promise.all(
      banks.map(async (b) => {
        const [book, stmts] = await Promise.all([
          this.prisma.journalLine.aggregate({
            where: { accountId: b.glAccountId, entry: { state: "FINAL" } },
            _sum: { debit: true, credit: true },
          }),
          this.prisma.bankStatement.aggregate({
            where: { bankAccountId: b.id },
            _sum: { amount: true },
            _count: true,
          }),
        ]);
        const bookBalance = Number(book._sum.debit ?? 0) - Number(book._sum.credit ?? 0);
        const statementTotal = Number(stmts._sum.amount ?? 0);
        return {
          id: b.id,
          name: b.name,
          bankName: b.bankName,
          accountNumber: b.accountNumber,
          glCode: b.account?.code ?? "—",
          glName: b.account?.name ?? "—",
          bookBalance,
          statementTotal,
          difference: bookBalance - statementTotal,
          statementCount: stmts._count,
          balanced: bookBalance === statementTotal,
        };
      }),
    );

    return {
      accounts: rows,
      reconciled: rows.filter((r) => r.balanced).length,
      mismatched: rows.filter((r) => !r.balanced).length,
      totalDifference: rows.reduce((s, r) => s + r.difference, 0),
    };
  }

  /**
   * چک‌های نزدیک سررسید و سررسید گذشته.
   *
   * برای داشبورد مدیریتی مهم‌ترین بخش است: چکی که برگشت می‌خورد
   * یعنی یک چک وصول‌نشده و کسری نقدینگی.
   */
  async checksDue(withinDays = 30) {
    const now = new Date();
    const horizon = new Date(now.getTime() + withinDays * 86_400_000);
    const DAY = 86_400_000;

    const rows = await this.prisma.check.findMany({
      where: { dueDate: { lte: horizon } },
      orderBy: { dueDate: "asc" },
      take: 500,
    });

    const open = rows.filter((c) => !["CLEARED", "CANCELLED", "BOUNCED", "RETURNED"].includes(c.status));

    type CheckView = {
      id: string;
      number: string;
      direction: string;
      bankName: string;
      amount: number;
      dueDate: string | null;
      status: string;
      drawer: string | null;
      payee: string | null;
      daysUntilDue: number | null;
    };

    const groups: { overdue: CheckView[]; dueSoon: CheckView[]; later: CheckView[] } = {
      overdue: [],
      dueSoon: [],
      later: [],
    };
    for (const c of open) {
      const days = c.dueDate ? Math.floor((new Date(c.dueDate).getTime() - now.getTime()) / DAY) : null;
      const view: CheckView = {
        id: c.id,
        number: c.number,
        direction: c.direction,
        bankName: c.bankName,
        amount: Number(c.amount),
        dueDate: c.dueDate?.toISOString() ?? null,
        status: c.status,
        drawer: c.drawer,
        payee: c.payee,
        daysUntilDue: days,
      };
      if (days != null && days < 0) groups.overdue.push(view);
      else if (days != null && days <= withinDays) groups.dueSoon.push(view);
      else groups.later.push(view);
    }

    const sumCheck = (xs: Array<{ amount: number }>) => xs.reduce((s, c) => s + c.amount, 0);
    return {
      withinDays,
      overdue: { count: groups.overdue.length, total: sumCheck(groups.overdue), items: groups.overdue },
      dueSoon: { count: groups.dueSoon.length, total: sumCheck(groups.dueSoon), items: groups.dueSoon },
      later: { count: groups.later.length, total: sumCheck(groups.later), items: groups.later },
    };
  }

  /**
   * ارزش‌گذاری و سود هر انبار (فاز ۶).
   *
   * چرا این گزارش لازم است: تا پیش از این، همهٔ انبارها روی حساب گروهی
   * `1200` می‌نشستند و ارزش موجودی‌شان قابل تفکیک نبود. حالا هر انبار حساب
   * دفتری خودش را دارد، پس می‌شود دید کدام شعبه کالا را نگه داشته و کدام
   * دارد هدر می‌دهد.
   *
   * دو منبع و تفاوتشان:
   *   • `账面` (دفتر) = ماندهٔ حساب GL انبار — ارزش حسابداری
   *   • `انبار` = ارزش بر پایهٔ دفتر کالا (تعداد × WAC)
   * اختلاف این دو یعنی انبار و دفتر دارند با هم نمی‌خوانند — و گفتنِ صریحشان
   * بهتر از نشان‌دادن یکی و پنهان‌کردن دیگری است.
   */
  async warehouseValuation(from?: string, to?: string) {
    const where = this.rangeWhere(from, to);

    const warehouses = await this.prisma.warehouse.findMany({
      where: { active: true },
      orderBy: [{ isDefault: "desc" }, { priority: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        code: true,
        type: true,
        isDefault: true,
        glAccountId: true,
        glAccount: { select: { code: true, name: true } },
      },
    });

    // ارزش دفتری از خطوط سند
    const bookLines = await this.prisma.journalLine.groupBy({
      by: ["accountId"],
      where: {
        ...(where.date ? { entry: { state: "FINAL", date: where.date } } : { entry: { state: "FINAL" } }),
        account: { code: { startsWith: "1200" } },
      },
      _sum: { debit: true, credit: true },
    });

    const accounts = await this.prisma.account.findMany({
      where: { code: { startsWith: "1200" } },
      select: { id: true, code: true },
    });
    const accountById = new Map(accounts.map((a) => [a.id, a.code]));
    const bookByAccount = new Map(bookLines.map((l) => [l.accountId, Number(l._sum.debit ?? 0) - Number(l._sum.credit ?? 0)]));

    // ارزش انبار از دفتر کالا (تعداد × WAC)
    const stockRows = await this.prisma.stockLedgerEntry.groupBy({
      by: ["warehouseId"],
      where: { ...(where.date ? { createdAt: where.date } : {}) },
      _sum: { qtyIn: true, qtyOut: true },
    });
    const stockByWarehouse = new Map(stockRows.map((r) => [r.warehouseId, Number(r._sum.qtyIn ?? 0) - Number(r._sum.qtyOut ?? 0)]));

    // `CostLayer` ستون موجودی‌اش `quantity` است نه `qty`
    const layers = await this.prisma.costLayer.findMany({
      select: { warehouseId: true, variantSku: true, quantity: true, avgUnitCost: true },
      take: 20000,
    });

    // تعداد اقلام هر انبار برای محاسبهٔ ارزش
    const variants = await this.prisma.productVariant.findMany({
      where: { product: { deletedAt: null } },
      select: { sku: true },
    });
    const variantSet = new Set(variants.map((v) => v.sku));

    const rows = warehouses.map((w) => {
      const bookValue = w.glAccountId ? (bookByAccount.get(w.glAccountId) ?? 0) : null;
      const qty = stockByWarehouse.get(w.id) ?? 0;
      const inventoryValue = layers
        .filter((l) => l.warehouseId === w.id && variantSet.has(l.variantSku))
        .reduce((s, l) => s + Number(l.quantity) * Number(l.avgUnitCost), 0);
      // اگر انبار حساب ندارد، ارزش دفتری «نامشخص» است نه صفر
      const difference = bookValue == null ? null : bookValue - inventoryValue;
      return {
        id: w.id,
        name: w.name,
        code: w.code,
        type: w.type,
        isDefault: w.isDefault,
        glCode: w.glAccount?.code ?? null,
        glName: w.glAccount?.name ?? null,
        qty,
        bookValue,
        inventoryValue,
        difference,
        // انباری که هنوز حساب دفتری ندارد یا با انبار نمی‌خواند
        needsAttention: bookValue == null || Math.abs(difference ?? 0) > 1,
      };
    });

    const sum = (k: "bookValue" | "inventoryValue") =>
      rows.reduce((s, r) => s + (r[k] ?? 0), 0);

    return {
      range: { from: from ?? null, to: to ?? null },
      warehouses: rows,
      totals: {
        bookValue: sum("bookValue"),
        inventoryValue: sum("inventoryValue"),
        difference: sum("bookValue") - sum("inventoryValue"),
        needsAttention: rows.filter((r) => r.needsAttention).length,
      },
    };
  }

  /** بازهٔ زمانی استاندارد — نیم‌باز همه‌چیز را می‌گیرد */
  private rangeWhere(from?: string, to?: string) {
    if (!from && !to) return {};
    const date =
      from && to
        ? { gte: new Date(from), lte: new Date(`${to}T23:59:59.999Z`) }
        : from
          ? { gte: new Date(from) }
          : { lte: new Date(`${to}T23:59:59.999Z`) };
    return { date };
  }
}
