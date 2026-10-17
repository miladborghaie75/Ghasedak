import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CashFlowClass, cashFlowClass, isCashAccount } from "@ghasedak/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { optionalDate } from "../common/query-date";

/**
 * صورت جریان نقدی — روش مستقیم، از دفتر کل (گام ۱۲ · `[F1-2]`).
 *
 * چرا این سرویس جدا شد: منطق قبلی داخل کنترلر بود و سه نقص واقعی داشت که
 * با شاهد runtime تأیید شدند:
 *   ۱) حساب‌های نقدی فقط با کد دقیق `1000`/`1100` پیدا می‌شدند؛ پس هر
 *      زیرحسابی که خزانه می‌سازد (`1100-01`، `1100-02`، …) بی‌صدا از گزارش
 *      بیرون می‌افتاد (سند ۴٬۳۲۱٬۰۰۰ روی `1100-01` صفر اثر داشت).
 *   ۲) هیچ فیلتر `state` نداشت؛ سند `DRAFT` در جریان نقدی شمرده می‌شد
 *      (سند ۶٬۷۸۹٬۰۰۰ پیش‌نویس، ورودی نقدی را باد کرد).
 *   ۳) طبقه‌بندی عملیاتی/سرمایه‌ای/تأمین مالی نداشت و انتقال داخلی بین دو
 *      حساب نقد هم به‌عنوان ورودی و هم خروجی شمرده می‌شد.
 *
 * ریاضیات طبقه‌بندی (بدون تخصیص نسبتی):
 *   هر سند متوازن است ⇒ Σ(debit − credit) روی همهٔ خطوط = ۰.
 *   پس Σ(خطوط غیرنقدی: debit − credit) = −(تغییر نقدی سند).
 *   سهم هر حساب طرفِ سند در جریان نقدی = `credit − debit` همان خط.
 *   ⇒ جمع سهم طبقه‌ها دقیقاً برابر تغییر نقدی دوره است (تست phase16).
 */

export interface CashFlowClassTotals {
  inflow: string;
  outflow: string;
  net: string;
}

export interface CashFlowStatement {
  from: string;
  to: string;
  /** حساب‌های نقدی دیده‌شده (گروه + زیرحساب) — برای شفافیت گزارش */
  cashAccounts: Array<{ code: string; name: string }>;
  opening: string;
  inflow: string;
  outflow: string;
  net: string;
  closing: string;
  /** انتقال بین دو حساب نقد: نه ورودی است نه خروجی — جدا گزارش می‌شود */
  internalTransfers: { count: number; gross: string };
  classes: Record<CashFlowClass, CashFlowClassTotals>;
  /** حساب‌های طرفِ سندی که در کدینگ طبقه‌بندی نشده‌اند — صفر باید باشد */
  unclassified: Array<{ code: string; name: string; net: string }>;
  monthly: Array<{ month: number; inflow: string; outflow: string }>;
  monthlyClasses: Array<{ month: number } & Record<CashFlowClass, string>>;
}

const EMPTY_CLASS = (): CashFlowClassTotals => ({ inflow: "0", outflow: "0", net: "0" });
const CLASSES: CashFlowClass[] = ["OPERATING", "INVESTING", "FINANCING", "UNCLASSIFIED"];

@Injectable()
export class CashFlowService {
  constructor(private readonly prisma: PrismaService) {}

  /** بازهٔ گزارش — مقدار نامعتبر ۴۰۰ صریح می‌گیرد، نه گزارشِ سرِخود ساخته */
  private range(fromQ?: string, toQ?: string): { from: Date; to: Date } {
    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const from = optionalDate(fromQ, "from") ?? yearStart;
    const to = optionalDate(toQ, "to") ?? new Date();
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "تاریخ شروع بعد از تاریخ پایان است.",
      });
    }
    return { from, to };
  }

  async statement(fromQ?: string, toQ?: string): Promise<CashFlowStatement> {
    const { from, to } = this.range(fromQ, toQ);

    // منبع حساب‌های نقدی از «کدینگ» می‌آید (isCashAccount روی همهٔ حساب‌ها)،
    // پس افزودن زیرحساب بانک در خزانه خودکار در گزارش دیده می‌شود.
    const allAccounts = await this.prisma.account.findMany({
      select: { id: true, code: true, name: true, type: true },
    });
    const cashAccounts = allAccounts.filter((a) => isCashAccount(a.code));
    const cashIds = cashAccounts.map((a) => a.id);
    const nameByCode = new Map(allAccounts.map((a) => [a.code, a.name]));

    const monthly: CashFlowStatement["monthly"] = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      inflow: "0",
      outflow: "0",
    }));
    const monthlyClasses: CashFlowStatement["monthlyClasses"] = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      OPERATING: "0",
      INVESTING: "0",
      FINANCING: "0",
      UNCLASSIFIED: "0",
    }));
    const classes = Object.fromEntries(CLASSES.map((c) => [c, EMPTY_CLASS()])) as Record<
      CashFlowClass,
      CashFlowClassTotals
    >;

    // بدون هیچ حساب نقدی، گزارش «صفر صادقانه» است — نه عدد ساختگی
    if (cashIds.length === 0) {
      return {
        from: from.toISOString(),
        to: to.toISOString(),
        cashAccounts: [],
        opening: "0",
        inflow: "0",
        outflow: "0",
        net: "0",
        closing: "0",
        internalTransfers: { count: 0, gross: "0" },
        classes,
        unclassified: [],
        monthly,
        monthlyClasses,
      };
    }

    const cashIn = Prisma.join(cashIds);

    // (الف) مانده ابتدای دوره و گردش نقدی دوره — فقط اسناد FINAL
    const [openingRows, periodRows, internalRows, counterpartRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ bal: bigint }>>(Prisma.sql`
        SELECT COALESCE(SUM(l.debit - l.credit), 0)::bigint AS bal
        FROM "JournalLine" l
        JOIN "JournalEntry" e ON e.id = l."entryId"
        WHERE e.state = 'FINAL' AND l."accountId" IN (${cashIn}) AND e.date < ${from}
      `),

      this.prisma.$queryRaw<Array<{ net: bigint; inflow: bigint; outflow: bigint }>>(Prisma.sql`
        SELECT COALESCE(SUM(l.debit - l.credit), 0)::bigint AS net,
               COALESCE(SUM(GREATEST(l.debit - l.credit, 0)), 0)::bigint AS inflow,
               COALESCE(SUM(GREATEST(l.credit - l.debit, 0)), 0)::bigint AS outflow
        FROM "JournalLine" l
        JOIN "JournalEntry" e ON e.id = l."entryId"
        WHERE e.state = 'FINAL' AND l."accountId" IN (${cashIn})
          AND e.date >= ${from} AND e.date <= ${to}
      `),

      // انتقال داخلی: سندی که همهٔ خطوطش نقد است (پول بین دو حساب نقد جابه‌جا شده)
      this.prisma.$queryRaw<Array<{ cnt: number; gross: bigint }>>(Prisma.sql`
        WITH cash_lines AS (
          SELECT e.id AS eid, l.debit AS debit
          FROM "JournalEntry" e
          JOIN "JournalLine" l ON l."entryId" = e.id
          WHERE e.state = 'FINAL' AND e.date >= ${from} AND e.date <= ${to}
            AND l."accountId" IN (${cashIn})
        ), non_cash_entry AS (
          SELECT DISTINCT l."entryId" AS eid
          FROM "JournalLine" l
          WHERE l."accountId" NOT IN (${cashIn})
        )
        SELECT COUNT(DISTINCT cl.eid)::int AS cnt,
               COALESCE(SUM(cl.debit), 0)::bigint AS gross
        FROM cash_lines cl
        LEFT JOIN non_cash_entry nc ON nc.eid = cl.eid
        WHERE nc.eid IS NULL
      `),

      // (ب) سهم حساب‌های طرفِ سند — ریاضیات بالا: credit − debit
      this.prisma.$queryRaw<Array<{ code: string; ym: string; amount: bigint }>>(Prisma.sql`
        WITH cash_entry AS (
          SELECT l."entryId" AS eid
          FROM "JournalLine" l
          WHERE l."accountId" IN (${cashIn})
          GROUP BY l."entryId"
        )
        SELECT a.code AS code,
               to_char(e.date, 'YYYY-MM') AS ym,
               SUM(l.credit - l.debit)::bigint AS amount
        FROM "JournalEntry" e
        JOIN cash_entry ce ON ce.eid = e.id
        JOIN "JournalLine" l ON l."entryId" = e.id
        JOIN "Account" a ON a.id = l."accountId"
        WHERE e.state = 'FINAL'
          AND e.date >= ${from} AND e.date <= ${to}
          AND l."accountId" NOT IN (${cashIn})
        GROUP BY a.code, to_char(e.date, 'YYYY-MM')
      `),
    ]);

    const opening = openingRows[0]?.bal ?? 0n;
    const net = periodRows[0]?.net ?? 0n;
    const inflow = periodRows[0]?.inflow ?? 0n;
    const outflow = periodRows[0]?.outflow ?? 0n;

    const classNet: Record<CashFlowClass, bigint> = { OPERATING: 0n, INVESTING: 0n, FINANCING: 0n, UNCLASSIFIED: 0n };
    const classIn: Record<CashFlowClass, bigint> = { ...classNet };
    const classOut: Record<CashFlowClass, bigint> = { ...classNet };
    const unclassified = new Map<string, bigint>();
    const monthClass: Array<Record<CashFlowClass, bigint>> = monthlyClasses.map(() => ({
      OPERATING: 0n,
      INVESTING: 0n,
      FINANCING: 0n,
      UNCLASSIFIED: 0n,
    }));

    for (const row of counterpartRows) {
      const cls = cashFlowClass(row.code);
      const amount = row.amount;
      classNet[cls] += amount;
      if (amount > 0n) classIn[cls] += amount;
      else classOut[cls] += -amount;
      if (cls === "UNCLASSIFIED") {
        unclassified.set(row.code, (unclassified.get(row.code) ?? 0n) + amount);
      }
      const monthIndex = Number(row.ym.slice(5, 7)) - 1;
      if (monthIndex >= 0 && monthIndex < 12) monthClass[monthIndex][cls] += amount;
    }

    for (const cls of CLASSES) {
      classes[cls] = {
        inflow: classIn[cls].toString(),
        outflow: classOut[cls].toString(),
        net: classNet[cls].toString(),
      };
    }
    monthClass.forEach((acc, i) => {
      monthlyClasses[i].OPERATING = acc.OPERATING.toString();
      monthlyClasses[i].INVESTING = acc.INVESTING.toString();
      monthlyClasses[i].FINANCING = acc.FINANCING.toString();
      monthlyClasses[i].UNCLASSIFIED = acc.UNCLASSIFIED.toString();
    });

    // ناخالص ورودی/خروجی ماهانه از خطوط نقدی همان ماه (رفتار قبلی حفظ شد)
    const monthlyRows = await this.prisma.$queryRaw<Array<{ m: number; inflow: bigint; outflow: bigint }>>(
      Prisma.sql`
        SELECT EXTRACT(MONTH FROM e.date)::int AS m,
               COALESCE(SUM(GREATEST(l.debit - l.credit, 0)), 0)::bigint AS inflow,
               COALESCE(SUM(GREATEST(l.credit - l.debit, 0)), 0)::bigint AS outflow
        FROM "JournalLine" l
        JOIN "JournalEntry" e ON e.id = l."entryId"
        WHERE e.state = 'FINAL' AND l."accountId" IN (${cashIn})
          AND e.date >= ${from} AND e.date <= ${to}
        GROUP BY EXTRACT(MONTH FROM e.date)
      `,
    );
    for (const row of monthlyRows) {
      const i = Number(row.m) - 1;
      if (i >= 0 && i < 12) {
        monthly[i] = { month: i + 1, inflow: row.inflow.toString(), outflow: row.outflow.toString() };
      }
    }

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      cashAccounts: cashAccounts.map((a) => ({ code: a.code, name: a.name })),
      opening: opening.toString(),
      inflow: inflow.toString(),
      outflow: outflow.toString(),
      net: net.toString(),
      closing: (opening + net).toString(),
      internalTransfers: {
        count: Number(internalRows[0]?.cnt ?? 0),
        gross: (internalRows[0]?.gross ?? 0n).toString(),
      },
      classes,
      unclassified: [...unclassified.entries()]
        .map(([code, amount]) => ({ code, name: nameByCode.get(code) ?? code, net: amount.toString() }))
        .sort((a, b) => a.code.localeCompare(b.code)),
      monthly,
      monthlyClasses,
    };
  }
}
