/**
 * گام ۱۲ (`[F1-2]`) — گزارش‌های مالی: صورت جریان نقدی طبقه‌بندی‌شده، تراز
 * آزمایشی دوره‌ای، خروجی CSV.
 *
 * درس گرفته‌شده از فاز ۱۱: آن تست منطق endpoint را **بازنویسی** می‌کرد، پس اگر
 * خود endpoint عوض می‌شد تست نمی‌فهمید. اینجا سرویس و کنترلرِ **واقعی** نمونه‌سازی
 * و صدا زده می‌شوند و فقط ورودی/خروجی سنجیده می‌شود.
 *
 * چهار نقصی که این تست قفل می‌کند (هر چهار مورد با شاهد runtime هم تأیید شده):
 *   ۱) سند روی زیرحساب بانک (`1100-xx`) در گزارش دیده شدن.
 *   ۲) سند `DRAFT` هرگز در جریان نقدی شمرده نشدن.
 *   ۳) طبقه‌بندی عملیاتی/سرمایه‌ای/تأمین مالی + سطل صریح «طبقه‌بندی‌نشده».
 *   ۴) انتقال بین دو حساب نقد، ورودی/خروجی جمع را باد نکردن.
 */
import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import type { Response } from "express";
import { PrismaService } from "../src/prisma/prisma.service";
import { JournalService } from "../src/accounting/journal.service";
import { CashFlowService } from "../src/accounting/cash-flow.service";
import { DashboardService } from "../src/accounting/dashboard.service";
import { ReportsService } from "../src/accounting/reports.service";
import { AccountingReportsController } from "../src/accounting/accounting-reports.controller";
import { CSV_BOM, csvCell, csvFilename, toCsv } from "../src/accounting/csv";
import { optionalDate } from "../src/common/query-date";

jest.setTimeout(120_000);

const tag = `p16${Date.now()}`;
/**
 * بازهٔ آزمون داخل سال مالی ۱۴۰۵ (2026-03-21 .. 2027-03-20).
 *
 * پنجرهٔ باریک (سه روز) انتخاب شد تا دادهٔ سوئیت‌های دیگر — که همه با تاریخ
 * «حالا» سند می‌زنند — وارد این گزارش نشود؛ در غیر این صورت اعداد مطلق
 * آزمون به ترتیب اجرا وابسته می‌شد.
 */
const FROM = new Date("2026-06-14T00:00:00Z");
const TO = new Date("2026-06-16T12:00:00Z");
const ENTRY_DATE = new Date("2026-06-15T10:00:00Z");
/** حساب آزمون با کد ریشهٔ ناموجود در طبقه‌بندی → باید «طبقه‌بندی‌نشده» شود */
const TEMP_CODE = `T16UNCLASS${Date.now().toString().slice(-6)}`;

describe("Phase 16 — گزارش‌های مالی گام ۱۲", () => {
  let prisma: PrismaService;
  let journal: JournalService;
  let cashFlow: CashFlowService;
  let reports: AccountingReportsController;

  const created: string[] = [];

  async function post(
    state: "DRAFT" | "FINAL",
    lines: Array<{ accountCode: string; debit?: number; credit?: number }>,
  ): Promise<void> {
    const r = await journal.postManual({
      date: ENTRY_DATE,
      description: `${tag} — سند آزمون گزارش`,
      sourceType: "manual",
      actorId: undefined,
      state,
      lines,
    });
    created.push(r.id);
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    journal = new JournalService(prisma);
    cashFlow = new CashFlowService(prisma);
    reports = new AccountingReportsController(prisma, journal, cashFlow);

    await prisma.account.create({
      data: { code: TEMP_CODE, name: `${tag} حساب طبقه‌بندی‌نشده`, type: "ASSET", level: 1, isActive: true },
    });

    // الف) فروش واریزشده به زیرحساب بانک — نقص ۱
    await post("FINAL", [
      { accountCode: "1100-01", debit: 1_000_000 },
      { accountCode: "4000", credit: 1_000_000 },
    ]);
    // ب) سند پیش‌نویس روی صندوق — نقص ۲ (نباید هیچ‌جا دیده شود)
    await post("DRAFT", [
      { accountCode: "1000", debit: 5_000_000 },
      { accountCode: "4000", credit: 5_000_000 },
    ]);
    // ج) انتقال داخلی بین دو بانک — نقص ۴
    await post("FINAL", [
      { accountCode: "1100-01", debit: 700_000 },
      { accountCode: "1100-02", credit: 700_000 },
    ]);
    // د) آوردهٔ سرمایه → تأمین مالی — نقص ۳
    await post("FINAL", [
      { accountCode: "1000", debit: 2_000_000 },
      { accountCode: "3000", credit: 2_000_000 },
    ]);
    // ه) پرداخت حقوق (بدهی 2101) → عملیاتی — نقص ۳ (قبلاً طبقه‌بندی‌نشده می‌شد)
    await post("FINAL", [
      { accountCode: "2101", debit: 300_000 },
      { accountCode: "1000", credit: 300_000 },
    ]);
    // و) جریان روی حساب ناشناخته → باید در سطل «طبقه‌بندی‌نشده» ظاهر شود
    await post("FINAL", [
      { accountCode: "1000", debit: 400_000 },
      { accountCode: TEMP_CODE, credit: 400_000 },
    ]);
  });

  afterAll(async () => {
    await prisma.journalEntry.deleteMany({ where: { description: { contains: tag } } });
    await prisma.account.deleteMany({ where: { code: TEMP_CODE } });
    await prisma.$disconnect();
  });

  const range = { from: FROM.toISOString(), to: TO.toISOString() };
  const big = (v: string) => BigInt(v);

  it("جریان نقدی: بازهٔ خالی گزارش را نمی‌شکند (صفر صادقانه، بدون خطا)", async () => {
    const empty = await cashFlow.statement("2020-01-01", "2020-01-31");
    expect(empty.net).toBe("0");
    expect(empty.opening).toBe("0");
    expect(empty.classes.OPERATING.net).toBe("0");
    expect(empty.internalTransfers.count).toBe(0);
  });

  it("نقص ۱: سند روی زیرحساب بانک در گزارش دیده می‌شود", async () => {
    const cf = await cashFlow.statement(range.from, range.to);
    // هر دو زیرحساب در گزارش دیده می‌شوند (قبل از گام ۱۲ فقط کد دقیق
    // `1000`/`1100` اسکن می‌شد و این دو بی‌صدا از گزارش می‌افتادند)
    expect(cf.cashAccounts.map((a) => a.code)).toEqual(expect.arrayContaining(["1100-01", "1100-02", "1000"]));
    // ورودی ناخالص روی زیرحساب 1100-01 = ۱٬۰۰۰٬۰۰۰ فروش + ۷۰۰٬۰۰۰ انتقال داخلی؛
    // دو سند دیگر بازه (سرمایه ۲٬۰۰۰٬۰۰۰ و حساب ناشناخته ۴۰۰٬۰۰۰) روی صندوق‌اند
    expect(big(cf.inflow) - 2_400_000n).toBe(1_700_000n);
  });

  it("نقص ۲: سند DRAFT در جریان نقدی شمرده نمی‌شود", async () => {
    const cf = await cashFlow.statement(range.from, range.to);
    // سند پیش‌نویس ۵٬۰۰۰٬۰۰۰ روی صندوق بود؛ اگر شمرده می‌شد، ورودی ناخالص
    // دست‌کم ۵ میلیون بیشتر می‌شد.
    // ورودی‌های واقعی این بازه: ۱٬۰۰۰٬۰۰۰ + ۷۰۰٬۰۰۰ + ۲٬۰۰۰٬۰۰۰ + ۴۰۰٬۰۰۰ = ۴٬۱۰۰٬۰۰۰
    expect(big(cf.inflow)).toBe(4_100_000n);
  });

  it("نقص ۳: طبقه‌بندی — عملیاتی/تأمین مالی/طبقه‌بندی‌نشده درست تفکیک می‌شوند", async () => {
    const cf = await cashFlow.statement(range.from, range.to);
    // عملیاتی: +۱٬۰۰۰٬۰۰۰ (فروش) − ۳۰۰٬۰۰۰ (حقوق، حساب 2101)
    expect(big(cf.classes.OPERATING.net)).toBe(700_000n);
    // تأمین مالی: آوردهٔ سرمایه
    expect(big(cf.classes.FINANCING.net)).toBe(2_000_000n);
    // سرمایه‌ای: در این کدینگ حسابی ندارد → صفر صادقانه
    expect(big(cf.classes.INVESTING.net)).toBe(0n);
    // حساب ناشناخته صریح گزارش می‌شود، نه اینکه بی‌صدا عملیاتی فرض شود
    expect(big(cf.classes.UNCLASSIFIED.net)).toBe(400_000n);
    expect(cf.unclassified.map((u) => u.code)).toContain(TEMP_CODE);

    // ریاضیات گزارش: جمع طبقه‌ها = خالص کل، و ابتدا + خالص = پایان
    const sum = (["OPERATING", "INVESTING", "FINANCING", "UNCLASSIFIED"] as const).reduce(
      (acc, k) => acc + big(cf.classes[k].net),
      0n,
    );
    expect(sum).toBe(big(cf.net));
    expect(big(cf.opening) + big(cf.net)).toBe(big(cf.closing));
  });

  it("نقص ۴: انتقال داخلی در جمع نمی‌آید و جدا گزارش می‌شود", async () => {
    const cf = await cashFlow.statement(range.from, range.to);
    expect(cf.internalTransfers.count).toBe(1);
    expect(big(cf.internalTransfers.gross)).toBe(700_000n);
    // پای انتقال انتهایی (بستانکار 1100-02) در «خروجی ناخالص» دیده می‌شود —
    // این درست است: پول واقعاً از آن حساب بیرون رفته. اما در **خالص** بی‌اثر
    // است، چون پای دیگر (بدهکار 1100-01) به همان اندازه ورودی است.
    expect(big(cf.inflow)).toBe(4_100_000n);
    expect(big(cf.outflow)).toBe(1_000_000n); // ۷۰۰٬۰۰۰ انتقال + ۳۰۰٬۰۰۰ حقوق
    expect(big(cf.net)).toBe(3_100_000n); // = ۷۰۰٬۰۰۰ عملیاتی + ۲٬۰۰۰٬۰۰۰ تأمین مالی + ۴۰۰٬۰۰۰ طبقه‌بندی‌نشده
  });

  it("جریان نقدی: جمع طبقه‌ها با خطوط نقدی همان بازه می‌خواند (تطبیق با خزانه)", async () => {
    const cf = await cashFlow.statement(range.from, range.to);
    // جمع مستقل از خودِ دفتر: تغییر خالص حساب‌های نقدی در همان بازه
    const agg = await prisma.journalLine.findMany({
      where: { entry: { state: "FINAL", date: { gte: FROM, lte: TO } } },
      select: { debit: true, credit: true, account: { select: { code: true } } },
    });
    const fromGl = agg
      .filter((l) => l.account.code.startsWith("1000") || l.account.code.startsWith("1100"))
      .reduce((acc, l) => acc + (l.debit ?? 0n) - (l.credit ?? 0n), 0n);
    expect(big(cf.net)).toBe(fromGl);
  });

  it("کارت نقد داشبورد از دفتر کل می‌آید، نه فقط حساب‌های ثبت‌شده در خزانه", async () => {
    const dashboard = new DashboardService(prisma, new ReportsService(prisma));
    const cash = await dashboard.cashBalance();

    const accounts = await prisma.account.findMany({ select: { id: true, code: true } });
    const ids = accounts
      .filter(
        (a) =>
          a.code === "1000" ||
          a.code === "1100" ||
          a.code.startsWith("1000-") ||
          a.code.startsWith("1100-"),
      )
      .map((a) => a.id);
    const agg = await prisma.journalLine.aggregate({
      where: { accountId: { in: ids }, entry: { state: "FINAL" } },
      _sum: { debit: true, credit: true },
    });
    const fromGl = Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0);
    expect(cash).toBe(fromGl);

    // فیکسچرهای همین آزمون روی زیرحساب بانک پول گذاشته‌اند. نسخهٔ قبلی کارت
    // فقط حساب‌های بانکیِ ثبت‌شده در خزانه را جمع می‌زد و چون گردش فروش روی
    // گروه `1100` می‌نشیند، کارت «نقد (بانک + صندوق)» عدد ۰ نشان می‌داد.
    expect(cash).toBeGreaterThanOrEqual(1_700_000);
  });

  it("تراز آزمایشی: بازه، جمع‌ها و فلگ توازن", async () => {
    const period = await journal.trialBalance(FROM, TO);
    expect(period.from).not.toBeNull();
    expect(period.to).not.toBeNull();
    expect(period.balanced).toBe(true);
    expect(period.totals.debit).toBe(period.totals.credit);

    // جمع ردیف‌ها = جمع گزارش (بدون محاسبهٔ موازی در مصرف‌کننده)
    const rowSum = period.items.reduce((acc, r) => acc + BigInt(r.debit), 0n);
    expect(rowSum).toBe(BigInt(period.totals.debit));

    // همهٔ خطوط بازه: جمع بدهکار باید برابر جمع خطوط FINAL همان بازه باشد
    const ledger = await prisma.journalLine.aggregate({
      where: { entry: { state: "FINAL", date: { gte: FROM, lte: TO } } },
      _sum: { debit: true },
    });
    expect(BigInt(period.totals.debit)).toBe(ledger._sum.debit ?? 0n);

    // بازهٔ کامل = خروجی کنترل سازگاری کل دفتر
    const full = await journal.trialBalance();
    const integrity = await journal.integrity();
    expect(full.totals.debit).toBe(integrity.debit);
    expect(full.balanced).toBe(integrity.balanced);
    expect(full.from).toBeNull();
  });

  it("تاریخ نامعتبر در query → ۴۰۰ صریح (نه گزارش سرِخود ساخته)", async () => {
    expect(() => optionalDate("notadate", "from")).toThrow(BadRequestException);
    expect(optionalDate(undefined, "from")).toBeUndefined();
    expect(optionalDate("", "to")).toBeUndefined();
    await expect(cashFlow.statement("notadate", undefined)).rejects.toThrow(BadRequestException);
    // شروع بعد از پایان
    await expect(cashFlow.statement("2026-07-01", "2026-06-01")).rejects.toThrow(BadRequestException);
  });

  it("خروجی CSV: سرصفحه، BOM و طبقه‌ها از همان منبع JSON می‌آیند", async () => {
    const headers: Record<string, string> = {};
    const sent: string[] = [];
    const fakeRes = {
      setHeader: (k: string, v: string) => {
        headers[k.toLowerCase()] = v;
      },
      send: (body: string) => {
        sent.push(body);
      },
    } as unknown as Response;

    await reports.exportReport("cash-flow", { from: range.from, to: range.to }, fakeRes);
    expect(headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(headers["content-disposition"]).toContain('filename="cash-flow-2026-06-14_2026-06-16.csv"');
    const body = sent[0];
    expect(body.startsWith(CSV_BOM)).toBe(true);
    expect(body).toContain("OPERATING");
    expect(body).toContain("700000"); // خالص عملیاتی از همان سرویس
    expect(body).toContain("INTERNAL_COUNT,1");

    await reports.exportReport("trial-balance", {}, fakeRes);
    expect(sent[1]).toContain("کد حساب,نام حساب,نوع,بدهکار,بستانکار");
    expect(headers["content-disposition"]).toContain('filename="trial-balance-all.csv"');

    await expect(reports.exportReport("unknown-report", {}, fakeRes)).rejects.toThrow(BadRequestException);
    await expect(reports.exportReport("cash-flow", { from: "13-99-99" }, fakeRes)).rejects.toThrow(BadRequestException);
  });
});

describe("Phase 16 — نویسندهٔ CSV (خالص)", () => {
  it("نقل‌قول RFC4180 و پایان خط ویندوزی", () => {
    const csv = toCsv([["a,b", 'x"y', "line\nbreak"], ["plain", 1, null]]);
    expect(csv).toBe('"a,b","x""y","line\nbreak"\r\nplain,1,\r\n');
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("تزریق فرمول خنثی می‌شود، ولی عدد منفی عدد می‌ماند", () => {
    expect(csvCell("=cmd|' /C calc'!A0").startsWith("'")).toBe(true);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tleading-tab").startsWith("'")).toBe(true);
    // فرمولی که با عدد شروع می‌شود ولی عدد خالص نیست
    expect(csvCell("-2+3+cmd|' /C calc'!A0").startsWith("'")).toBe(true);
    // عددهای واقعی باید عدد بمانند (خالص منفی گزارش‌ها متن نشود)
    expect(csvCell("-1234")).toBe("-1234");
    expect(csvCell(-4_000_000n)).toBe("-4000000");
    expect(csvCell(null)).toBe("");
  });

  it("نام فایل: بازهٔ محلی و حالت بدون بازه", () => {
    expect(csvFilename("trial-balance", null, null)).toBe("trial-balance-all.csv");
    const from = new Date(2026, 5, 1);
    const to = new Date(2026, 5, 30);
    expect(csvFilename("cash-flow", from, to)).toBe("cash-flow-2026-06-01_2026-06-30.csv");
    // تقویم محلی، نه UTC: بازهٔ «از اول فروردین» نباید ۳۰ اسفند سال قبل چاپ شود
    const yearStart = new Date(2026, 0, 1);
    expect(csvFilename("pnl", yearStart, to)).toBe("pnl-2026-01-01_2026-06-30.csv");
    expect(csvFilename("CASH Flow!", null, null)).toBe("cash-flow-all.csv");
  });
});
