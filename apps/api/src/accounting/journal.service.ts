import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { money, type Money } from "@ghasedak/contracts";

export interface JournalLineInput {
  accountCode: string;
  debit?: number;
  credit?: number;
  partyType?: string;
  partyId?: string;
}

export interface PostEntryInput {
  date?: Date;
  description?: string;
  sourceType?: string;
  sourceId?: string;
  actorId?: string;
  lines: JournalLineInput[];
}

/**
 * موتور سند حسابداری — بند ۲۴/۲۵: Double-entry واقعی با قید سخت Dr=Cr.
 * همه تراکنش‌ها از این سرویس عبور می‌کنند؛ UI هرگز مستقیم سند نمی‌سازد (بند ۲۵).
 */
@Injectable()
export class JournalService {
  constructor(private readonly prisma: PrismaService) {}

  async post(input: PostEntryInput): Promise<{ id: string; number: string }> {
    if (!input.lines || input.lines.length < 2) {
      throw new BadRequestException({ code: "JOURNAL_INVALID", message: "سند حداقل دو ردیف لازم دارد." });
    }

    let debitTotal = 0;
    let creditTotal = 0;
    const prepared: Array<{ accountCode: string; debit: Money; credit: Money; partyType?: string; partyId?: string }> = [];
    for (const line of input.lines) {
      const debit = line.debit ?? 0;
      const credit = line.credit ?? 0;
      if (debit < 0 || credit < 0) {
        throw new BadRequestException({ code: "JOURNAL_INVALID", message: "مبالغ منفی مجاز نیست." });
      }
      if (debit > 0 && credit > 0) {
        throw new BadRequestException({ code: "JOURNAL_INVALID", message: "هر ردیف یا بدهکار است یا بستانکار." });
      }
      if (debit === 0 && credit === 0) {
        throw new BadRequestException({ code: "JOURNAL_INVALID", message: "ردیف صفر مجاز نیست." });
      }
      debitTotal += debit;
      creditTotal += credit;
      prepared.push({
        accountCode: line.accountCode,
        debit: money(debit),
        credit: money(credit),
        partyType: line.partyType,
        partyId: line.partyId,
      });
    }
    if (debitTotal !== creditTotal) {
      // قید سخت بند ۲۴/۱۲۸: سند نامتوازن هرگز finalize نمی‌شود
      throw new BadRequestException({
        code: "JOURNAL_UNBALANCED",
        message: `سند متوازن نیست: بدهکار ${debitTotal} ≠ بستانکار ${creditTotal}`,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const year = await tx.fiscalYear.findFirst({ where: { state: "OPEN" } });
      if (!year) {
        throw new BadRequestException({ code: "NO_OPEN_FISCAL_YEAR", message: "سال مالی بازی وجود ندارد." });
      }

      // شماره‌گذاری اتمیک (بند ۴۵/۸۲) — nextNumber در DB Int است
      const series = await tx.$queryRaw<{ nextNumber: number }[]>`
        SELECT "nextNumber" FROM "NumberSeries" WHERE scope = 'journal' FOR UPDATE`;
      let seq = 1;
      if (series.length === 0) {
        await tx.numberSeries.create({ data: { scope: "journal", prefix: "JE", nextNumber: 2, padding: 5 } });
      } else {
        seq = series[0].nextNumber;
        await tx.numberSeries.update({
          where: { scope: "journal" },
          data: { nextNumber: seq + 1 },
        });
      }
      const number = `JE-${String(seq).padStart(5, "0")}`;

      const entry = await tx.journalEntry.create({
        data: {
          number,
          fiscalYearId: year.id,
          date: input.date ?? new Date(),
          description: input.description,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          state: "FINAL",
          actorId: input.actorId,
          lines: {
            create: await Promise.all(
              prepared.map(async (l) => {
                const account = await tx.account.findUnique({ where: { code: l.accountCode } });
                if (!account) {
                  throw new BadRequestException({
                    code: "ACCOUNT_NOT_FOUND",
                    message: `حساب ${l.accountCode} یافت نشد.`,
                  });
                }
                return {
                  accountId: account.id,
                  debit: BigInt(l.debit.amount),
                  credit: BigInt(l.credit.amount),
                  partyType: l.partyType,
                  partyId: l.partyId,
                };
              }),
            ),
          },
        },
      });
      return { id: entry.id, number: entry.number };
    });
  }

  /** تراز آزمایشی — از منبع حقیقت Ledger (بند ۱۰۶/۱۰۷) */
  async trialBalance(): Promise<Array<{ code: string; name: string; debit: string; credit: string }>> {
    const rows = await this.prisma.journalLine.groupBy({
      by: ["accountId"],
      _sum: { debit: true, credit: true },
    });
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: rows.map((r) => r.accountId) } },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return rows
      .map((r) => {
        const a = byId.get(r.accountId)!;
        return {
          code: a.code,
          name: a.name,
          debit: (r._sum.debit ?? 0n).toString(),
          credit: (r._sum.credit ?? 0n).toString(),
        };
      })
      .sort((x, y) => x.code.localeCompare(y.code));
  }

  /** کنترل سازگاری مالی — بند ۶۶: ΣDr = ΣCr روی کل Ledger */
  async integrity(): Promise<{ balanced: boolean; debit: string; credit: string }> {
    const agg = await this.prisma.journalLine.aggregate({ _sum: { debit: true, credit: true } });
    const d = agg._sum.debit ?? 0n;
    const c = agg._sum.credit ?? 0n;
    return { balanced: d === c, debit: d.toString(), credit: c.toString() };
  }
}
