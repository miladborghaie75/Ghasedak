import { BadRequestException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
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

  /**
   * درس ریسک ۶ (audit معماری): شکست سند هرگز بی‌صدا swallow نمی‌شود.
   * عملیات اصلی (GRN/فاکتور/پرداخت/…) سرِ جایش می‌ماند (سند اثر ثانویه است)، اما:
   * 1) Notification(ADMIN) با جزئیات کامل (sourceType/sourceId/کد خطا/شرح) — در زنگ ادمین
   * 2) AuditLog با action accounting.post.failure — دنبال‌پذیر دائمی
   * 3) خروجی { posted: false, error } تا caller اگر خواست صریحاً تصمیم بگیرد
   * idempotent key: sourceType+sourceId+errorCode+ساعت — طوفان نوتیف نمی‌سازد (بند ۱۱۶).
   */
  async postOrNotify(input: PostEntryInput): Promise<{ posted: boolean; id?: string; number?: string; error?: { code?: string; message: string } }> {
    try {
      const r = await this.post(input);
      return { posted: true, id: r.id, number: r.number };
    } catch (e) {
      return this.notifyPostFailure(e, input);
    }
  }

  /**
   * شکست سند داخل تراکنشِ فراخوان — همان قرارداد درس ریسک ۶: تراکنش دامنه‌ی اصلی rollback می‌شود
   * (درست است؛ عملیات مالی با سند هم‌پیمان‌اند) اما شکست هرگز بی‌صدا نیست:
   * Notification(ADMIN) + AuditLog + console.error — سپس خطا دوباره پرتاب می‌شود تا rollback رخ دهد.
   */
  async postOrNotifyInTx(tx: Prisma.TransactionClient, input: PostEntryInput): Promise<{ id: string; number: string }> {
    try {
      return await this.postInTx(tx, input);
    } catch (e) {
      await this.notifyPostFailure(e, input);
      throw e;
    }
  }

  /** ثبت شکست سند: Notification ساعتی idempotent + AuditLog + console.error (هرگز throw نمی‌کند) */
  async notifyPostFailure(e: unknown, input: PostEntryInput): Promise<{ posted: false; error: { code?: string; message: string } }> {
    {
      const errBody = (e as { response?: { code?: string; message?: string } }).response ?? null;
      const code = errBody?.code ?? (e instanceof Error ? e.constructor.name : "UNKNOWN");
      const message = errBody?.message ?? (e instanceof Error ? e.message : String(e));
      const sourceKey = `${input.sourceType ?? "manual"}:${input.sourceId ?? "-"}`;
      const hourBucket = new Date().toISOString().slice(0, 13); // نوتیف ساعتی — idempotent
      // JSON-safe payload (JournalLineInput[] → plain object[])
      const safeLines = JSON.parse(JSON.stringify(input.lines ?? [])) as object[];
      try {
        const dup = await this.prisma.notification.findFirst({
          where: { channel: "ADMIN", templateKey: `journal-fail:${sourceKey}:${code}:${hourBucket}` },
        });
        if (!dup) {
          await this.prisma.notification.create({
            data: {
              channel: "ADMIN",
              templateKey: `journal-fail:${sourceKey}:${code}:${hourBucket}`,
              to: "admin-dashboard",
              payload: {
                title: `⚠️ شکست سند حسابداری — ${sourceKey}`,
                code,
                message,
                sourceType: input.sourceType ?? null,
                sourceId: input.sourceId ?? null,
                description: input.description ?? null,
                lines: safeLines,
              },
            },
          });
        }
        await this.prisma.auditLog.create({
          data: {
            actorId: input.actorId ?? null,
            action: "accounting.post.failure",
            entity: "JournalEntry",
            entityId: input.sourceId ?? sourceKey,
            oldValues: {},
            newValues: { code, message, sourceType: input.sourceType ?? null, description: input.description ?? null, lines: safeLines },
          },
        });
      } catch {
        // حتی ثبت شکستِ ثبت‌شکست نباید درخواست اصلی را بشکند — اما لاگ ساختاری خروج هم می‌رود
      }
      // eslint-disable-next-line no-console
      console.error(`[journal.postOrNotify] FAILED ${sourceKey} ${code}: ${message}`, JSON.stringify(input.lines ?? []));
      return { posted: false, error: { code, message } };
    }
  }

  /**
   * پست سند داخل تراکنشِ فراخوان (فاز ۸ — خزانه): مانده صندوق/بانک و سند باید اتمیک با هم باشند.
   * همین منطق validation/numbering/create با post() مشترک است.
   */
  async postInTx(tx: Prisma.TransactionClient, input: PostEntryInput): Promise<{ id: string; number: string }> {
    const prepared = this.prepareLines(input.lines);
    return this.createEntryInTx(tx, input, prepared);
  }

  /** آماده‌سازی و اعتبارسنجی ردیف‌ها — مشترک بین post و postInTx */
  private prepareLines(lines: JournalLineInput[]): Array<{ accountCode: string; debit: Money; credit: Money; partyType?: string; partyId?: string }> {
    if (!lines || lines.length < 2) {
      throw new BadRequestException({ code: "JOURNAL_INVALID", message: "سند حداقل دو ردیف لازم دارد." });
    }
    let debitTotal = 0;
    let creditTotal = 0;
    const prepared: Array<{ accountCode: string; debit: Money; credit: Money; partyType?: string; partyId?: string }> = [];
    for (const line of lines) {
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
    return prepared;
  }

  /** ایجاد سند داخل تراکنش — مشترک بین post و postInTx (شماره‌گذاری اتمیک بند ۴۵/۸۲) */
  private async createEntryInTx(
    tx: Prisma.TransactionClient,
    input: PostEntryInput,
    prepared: Array<{ accountCode: string; debit: Money; credit: Money; partyType?: string; partyId?: string }>,
  ): Promise<{ id: string; number: string }> {
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
  }

  async post(input: PostEntryInput): Promise<{ id: string; number: string }> {
    const prepared = this.prepareLines(input.lines);
    return this.prisma.$transaction(async (tx) => this.createEntryInTx(tx, input, prepared));
  }

  /**
   * فاز ۱۰ — بخش ۱۳: ثبت سند دستی با state DRAFT/FINAL.
   * سند FINAL همان قواعد سخت post را دارد؛ DRAFT هنوز در تراز کلان اثر مالی ندارد ولی
   * برای بازبینی ذخیره می‌شود و finalize بعدی همان prepareLines را دوباره اجرا می‌کند.
   * واجبات: حداقل ۲ ردیف، هر ردیف فقط Dr یا Cr مثبت، Dr=Cr، حساب فعال، سال مالی باز (بخش ۱۳).
   */
  async postManual(input: PostEntryInput & { state?: "DRAFT" | "FINAL" }): Promise<{ id: string; number: string; state: string }> {
    const state = input.state === "DRAFT" ? "DRAFT" : "FINAL";
    // اعتبارسنجی مشترک (برای DRAFT هم اجرا می‌شود تا سند معیوب ذخیره نشود)
    const prepared = this.prepareLines(input.lines);
    // حساب فعال — فقط برای دستی (رویدادهای سیستمی روی حساب‌های شناخته‌شده‌اند)
    const codes = [...new Set(prepared.map((l) => l.accountCode))];
    const accounts = await this.prisma.account.findMany({ where: { code: { in: codes } } });
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    for (const code of codes) {
      const acc = byCode.get(code);
      if (!acc) {
        throw new BadRequestException({ code: "ACCOUNT_NOT_FOUND", message: `حساب ${code} یافت نشد.` });
      }
      if (!acc.isActive) {
        throw new BadRequestException({ code: "ACCOUNT_INACTIVE", message: `حساب ${acc.code} — ${acc.name} غیرفعال است.` });
      }
    }
    const entry = await this.prisma.$transaction(async (tx) => {
      const year = await tx.fiscalYear.findFirst({ where: { state: "OPEN" } });
      if (!year) {
        throw new BadRequestException({ code: "NO_OPEN_FISCAL_YEAR", message: "سال مالی بازی وجود ندارد." });
      }
      const inputDate = input.date ?? new Date();
      if (inputDate < year.startsAt || inputDate > year.endsAt) {
        throw new BadRequestException({ code: "FISCAL_PERIOD_INVALID", message: "تاریخ سند در بازهٔ سال مالی باز نیست." });
      }
      // شماره‌گذاری اتمیک — همان قاعدهٔ createEntryInTx (بند ۴۵/۸۲)
      const series = await tx.$queryRaw<{ nextNumber: number }[]>`
        SELECT "nextNumber" FROM "NumberSeries" WHERE scope = 'journal' FOR UPDATE`;
      let seq = 1;
      if (series.length === 0) {
        await tx.numberSeries.create({ data: { scope: "journal", prefix: "JE", nextNumber: 2, padding: 5 } });
      } else {
        seq = series[0].nextNumber;
        await tx.numberSeries.update({ where: { scope: "journal" }, data: { nextNumber: seq + 1 } });
      }
      const number = `JE-${String(seq).padStart(5, "0")}`;
      return tx.journalEntry.create({
        data: {
          number,
          fiscalYearId: year.id,
          date: inputDate,
          description: input.description,
          sourceType: input.sourceType ?? "manual",
          sourceId: input.sourceId,
          state: state as never,
          actorId: input.actorId,
          lines: {
            create: prepared.map((l) => ({
              accountId: byCode.get(l.accountCode)!.id,
              debit: BigInt(l.debit.amount),
              credit: BigInt(l.credit.amount),
              partyType: l.partyType,
              partyId: l.partyId,
            })),
          },
        },
        select: { id: true, number: true, state: true },
      });
    });
    return entry;
  }

  /** فاز ۱۰ — نهایی‌سازی سند DRAFT: همان اعتبارسنجی، سپس FINAL (auditable) */
  async finalize(entryId: string, actorId?: string): Promise<{ id: string; number: string; state: string }> {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { id: entryId },
      include: { lines: { include: { account: { select: { code: true } } } } },
    });
    if (!entry) throw new BadRequestException({ code: "NOT_FOUND", message: "سند یافت نشد." });
    if (entry.state !== "DRAFT") {
      throw new BadRequestException({ code: "NOT_DRAFT", message: "فقط سند پیش‌نویس قابل نهایی‌سازی است." });
    }
    // بازبینی اعتبار با کد حساب‌ها — سند نهایی باید متوازن بماند
    const byId = new Map(entry.lines.map((l) => [l.accountId, l.account.code]));
    this.prepareLines(entry.lines.map((l) => ({
      accountCode: byId.get(l.accountId)!,
      debit: Number(l.debit),
      credit: Number(l.credit),
    })));
    const updated = await this.prisma.journalEntry.update({
      where: { id: entry.id },
      data: { state: "FINAL" },
      select: { id: true, number: true, state: true },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: actorId ?? null,
        action: "accounting.journal.finalize",
        entity: "JournalEntry",
        entityId: entry.id,
        oldValues: { state: "DRAFT", number: entry.number } as never,
        newValues: { state: "FINAL" } as never,
      },
    });
    return updated;
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

  /**
   * فاز ۱۰ — بخش ۱۴: درخت حساب‌ها از Account.parentAccountId/children موجود (بند: سیستم موازی ممنوع).
   * توازن هر حساب = مستقیم از Ledger (منبع حقیقت) — محاسبه موازی UI وجود ندارد.
   */
  async accountTree(): Promise<unknown> {
    const [accounts, agg, directLines] = await Promise.all([
      this.prisma.account.findMany({ orderBy: { code: "asc" } }),
      this.prisma.journalLine.groupBy({ by: ["accountId"], _sum: { debit: true, credit: true } }),
      this.prisma.journalLine.groupBy({
        by: ["accountId"],
        where: { account: { level: { gte: 1 } } },
        _sum: { debit: true, credit: true },
      }),
    ]);
    const directByAccount = new Map(directLines.map((l) => [l.accountId, l]));
    const byId = new Map(accounts.map((a) => [a.id, a as typeof accounts[number] & { children?: unknown[]; balanceDr: bigint; balanceCr: bigint }]));
    const roots: Array<typeof byId extends Map<string, infer V> ? V : never> = [];
    for (const a of byId.values()) {
      a.balanceDr = 0n;
      a.balanceCr = 0n;
    }
    // مبالغ مستقیم (خطوط جورنال روی خود حساب)
    for (const l of agg) {
      const a = byId.get(l.accountId);
      if (!a) continue;
      a.balanceDr += l._sum.debit ?? 0n;
      a.balanceCr += l._sum.credit ?? 0n;
    }
    // توازن تجمعی والد = مستقیم + همه فرزندان (شاخه‌ای)
    const subtree = (aId: string): { dr: bigint; cr: bigint } => {
      const a = byId.get(aId);
      if (!a) return { dr: 0n, cr: 0n };
      let dr = a.balanceDr;
      let cr = a.balanceCr;
      for (const child of byId.values()) {
        if (child.parentAccountId === aId) {
          const s = subtree(child.id);
          dr += s.dr;
          cr += s.cr;
        }
      }
      return { dr, cr };
    };
    for (const a of byId.values()) {
      if (!a.parentAccountId) {
        const s = subtree(a.id);
        a.balanceDr = s.dr;
        a.balanceCr = s.cr;
      }
    }
    const toNode = (a: (typeof accounts)[number] & { balanceDr: bigint; balanceCr: bigint }): Record<string, unknown> => ({
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      level: a.level,
      isActive: a.isActive,
      balanceDr: a.balanceDr.toString(),
      balanceCr: a.balanceCr.toString(),
      children: accounts.filter((c) => c.parentAccountId === a.id).map((c) => toNode(byId.get(c.id)!)),
    });
    const dr = new Map(agg.map((l) => [l.accountId, l._sum.debit ?? 0n]));
    void directByAccount; void dr;
    return {
      items: accounts.filter((a) => !a.parentAccountId).map((a) => toNode(byId.get(a.id)!)),
    };
  }

  /** فاز ۱۰ — بخش ۱۴: ایجاد حساب فرزند (کد یکتا، level+1، فعال) با audit */
  async createChildAccount(
    parentId: string,
    input: { code: string; name: string },
    actorId?: string,
  ): Promise<{ id: string; code: string; name: string; level: number }> {
    const code = input.code?.trim();
    const name = input.name?.trim();
    if (!code || !name) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "کد و نام حساب الزامی است." });
    const parent = await this.prisma.account.findUnique({ where: { id: parentId }, include: { children: true } });
    if (!parent) throw new BadRequestException({ code: "NOT_FOUND", message: "حساب والد یافت نشد." });
    const dup = await this.prisma.account.findUnique({ where: { code } });
    if (dup) throw new BadRequestException({ code: "DUPLICATE_CODE", message: "کد حساب تکراری است." });
    const created = await this.prisma.account.create({
      data: { code, name, type: parent.type, parentAccountId: parent.id, level: parent.level + 1, isActive: true },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: actorId ?? "system",
        action: "accounting.account.create",
        entity: "Account",
        entityId: created.id,
        oldValues: null as never,
        newValues: { code, name, parentCode: parent.code, level: parent.level + 1 } as never,
      },
    });
    return { id: created.id, code: created.code, name: created.name, level: created.level };
  }

  /** فاز ۱۰ — بخش ۱۴: فعال/غیرفعال‌سازی حساب (بدون حذف — traceability) */
  async setAccountActive(accountId: string, isActive: boolean, actorId?: string): Promise<{ id: string; isActive: boolean }> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new BadRequestException({ code: "NOT_FOUND", message: "حساب یافت نشد." });
    if (!isActive) {
      const used = await this.prisma.journalLine.count({ where: { accountId } });
      if (used > 0) throw new BadRequestException({ code: "ACCOUNT_IN_USE", message: "حساب سابقه تراکنش دارد — فقط غیرفعال می‌شود؛ برای غیبت کامل، والد آن را مدیریت کنید." });
      const hasChildren = await this.prisma.account.count({ where: { parentAccountId: accountId } });
      if (hasChildren > 0) throw new BadRequestException({ code: "HAS_CHILDREN", message: "حساب فرزند دارد." });
    }
    const updated = await this.prisma.account.update({ where: { id: accountId }, data: { isActive }, select: { id: true, isActive: true } });
    await this.prisma.auditLog.create({
      data: {
        actorId: actorId ?? "system",
        action: "accounting.account.setActive",
        entity: "Account",
        entityId: accountId,
        oldValues: { isActive: account.isActive } as never,
        newValues: { isActive } as never,
      },
    });
    return updated;
  }
}
