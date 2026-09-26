import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JournalService } from "../accounting/journal.service";
import { nextNumber } from "../common/number-series";

/**
 * فاز ۸ — خزانه (بند ۵۹–۶۲ سند Master): نقد و بانک به‌عنوان دفتر معین روی GL.
 * قواعد:
 *  - هیچ ماژول حسابداری موازی‌ای ساخته نمی‌شود (بند ۱۰۷): مانده هر حساب خزانه یک projection است؛
 *    منبع حقیقتِ GL همان JournalLine است. مانده صندوق/بانک فقط در همان تراکنش سند تغییر می‌کند.
 *  - درس ریسک ۶: سند با postOrNotifyInTx ثبت می‌شود — شکست سند ⇒ rollback مانده + Notification/Audit (هرگز بی‌صدا نیست).
 *  - شماره‌گذاری رسید/پرداخت/انتقال با NumberSeries اتمیک (بند ۸۱: scopeهای receipt/payment).
 *  توجه: روابط Prisma روی CashAccount/BankAccount/CashierShift به include تکیه نمی‌کنیم؛
 *  GL همیشه صریح با glAccountId واکشی می‌شود (مقاوم به کلاینت تولیدشده).
 */
@Injectable()
export class TreasuryService {
  private static GL_CASH = "1000"; // موجودی نقد — seed
  private static GL_BANK = "1100"; // بانک — seed
  private static GL_EQUITY = "3000"; // سرمایه — مقابلِ واریز مالک
  private static GL_EXPENSE = "6000"; // هزینه‌های عملیاتی — مقابلِ برداشت/هزینه نقدی

  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: JournalService,
  ) {}

  private amount(input: number, label: string): number {
    const n = Math.round(Number(input));
    if (!Number.isSafeInteger(n) || n <= 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: `${label} نامعتبر است.` });
    }
    return n;
  }

  /** کنترل موجودی کافی داخل تراکنش — مانده منفی صندوق/بانک ممنوع */
  private ensureSufficient(
    tx: Prisma.TransactionClient,
    table: "cashAccount" | "bankAccount",
    id: string,
    amount: number,
    label: string,
  ): Promise<void> {
    return (async () => {
      const row =
        table === "cashAccount"
          ? await tx.cashAccount.findUnique({ where: { id } })
          : await tx.bankAccount.findUnique({ where: { id } });
      if (!row) throw new NotFoundException({ code: "NOT_FOUND", message: `${label} یافت نشد.` });
      if (row.currentBalance < BigInt(amount)) {
        throw new BadRequestException({
          code: "INSUFFICIENT_FUNDS",
          message: `${label} موجودی کافی ندارد (مانده ${row.currentBalance} < مبلغ ${amount}).`,
        });
      }
    })();
  }

  private async glCodeOf(glAccountId: string): Promise<string> {
    const gl = await this.prisma.account.findUnique({ where: { id: glAccountId } });
    if (!gl) throw new BadRequestException({ code: "GL_MISSING", message: "حساب GL حساب خزانه یافت نشد." });
    return gl.code;
  }

  /** مانده دفتری GL — نقطه شروع projection هر حساب خزانه (هیچ محاسبه موازی‌ای ساخته نمی‌شود؛ بند ۱۰۷) */
  async glBookBalance(glAccountId: string): Promise<bigint> {
    const agg = await this.prisma.journalLine.aggregate({ where: { accountId: glAccountId }, _sum: { debit: true, credit: true } });
    return (agg._sum.debit ?? 0n) - (agg._sum.credit ?? 0n);
  }

  // ---------------- پرسش و فهرست ----------------

  /** فهرست حساب‌های خزانه + مانده دفتری GL هر حساب (از اسناد) برای مقایسه صادقانه */
  async listAccounts() {
    const [cash, bank] = await Promise.all([
      this.prisma.cashAccount.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      this.prisma.bankAccount.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    ]);
    const glIds = [...new Set([...cash, ...bank].map((a) => a.glAccountId))];
    const gls = await this.prisma.account.findMany({ where: { id: { in: glIds } } });
    const glById = new Map(gls.map((g) => [g.id, g]));
    const glBook = async (glId: string) => {
      const agg = await this.prisma.journalLine.aggregate({
        where: { accountId: glId },
        _sum: { debit: true, credit: true },
      });
      return (agg._sum.debit ?? 0n) - (agg._sum.credit ?? 0n);
    };
    const row = async (a: { glAccountId: string; openingBalance: bigint; currentBalance: bigint }) => {
      const gl = glById.get(a.glAccountId);
      return {
        glCode: gl?.code ?? "—",
        glName: gl?.name ?? "—",
        openingBalance: a.openingBalance.toString(),
        currentBalance: a.currentBalance.toString(),
        glBookBalance: (await glBook(a.glAccountId)).toString(),
      };
    };
    return {
      cash: await Promise.all(
        cash.map(async (a) => ({
          id: a.id,
          kind: a.kind,
          name: a.name,
          ...(await row(a)),
        })),
      ),
      bank: await Promise.all(
        bank.map(async (a) => ({
          id: a.id,
          name: a.name,
          bankName: a.bankName,
          accountNumber: a.accountNumber,
          iban: a.iban,
          ...(await row(a)),
        })),
      ),
    };
  }

  async summary() {
    const accounts = await this.listAccounts();
    const cashTotal = accounts.cash.reduce((acc, a) => acc + BigInt(a.currentBalance), 0n);
    const bankTotal = accounts.bank.reduce((acc, a) => acc + BigInt(a.currentBalance), 0n);
    const shifts = await this.prisma.cashierShift.findMany({ where: { state: "OPEN" } });
    const [registers, users] = await Promise.all([
      this.prisma.cashRegister.findMany({ where: { id: { in: [...new Set(shifts.map((s) => s.registerId))] } } }),
      this.prisma.user.findMany({ where: { id: { in: [...new Set(shifts.map((s) => s.userId))] } }, select: { id: true, name: true } }),
    ]);
    const regById = new Map(registers.map((r) => [r.id, r.name]));
    const userById = new Map(users.map((u) => [u.id, u.name]));
    const dueChecks = await this.prisma.check.findMany({
      where: { status: { in: ["RECEIVED", "ISSUED"] }, dueDate: { lte: new Date(Date.now() + 30 * 86_400_000) } },
      orderBy: { dueDate: "asc" },
      take: 20,
    });
    return {
      cashTotal: cashTotal.toString(),
      bankTotal: bankTotal.toString(),
      total: (cashTotal + bankTotal).toString(),
      openShifts: shifts.map((s) => ({
        id: s.id,
        register: regById.get(s.registerId) ?? "—",
        cashier: userById.get(s.userId) ?? "—",
        openingCash: s.openingCash.toString(),
        expenseTotal: s.expenseTotal.toString(),
        openedAt: s.openedAt.toISOString(),
      })),
      dueChecks: dueChecks.map((c) => ({
        id: c.id,
        direction: c.direction,
        status: c.status,
        number: c.number,
        bankName: c.bankName,
        amount: c.amount.toString(),
        dueDate: c.dueDate.toISOString(),
      })),
    };
  }

  // ---------------- ساخت حساب ----------------

  async createCashAccount(input: { name: string; kind?: string; glAccountCode?: string; openingBalance?: number; actorId?: string }) {
    const name = (input.name ?? "").trim();
    if (!name) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "نام صندوق الزامی است." });
    const kind = input.kind ?? "cash";
    if (!["cash", "bank", "card_settlement", "online_gateway", "petty"].includes(kind)) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "نوع صندوق نامعتبر است." });
    }
    const glCode = input.glAccountCode ?? (kind === "bank" ? TreasuryService.GL_BANK : TreasuryService.GL_CASH);
    const gl = await this.prisma.account.findUnique({ where: { code: glCode } });
    if (!gl) throw new BadRequestException({ code: "GL_MISSING", message: `حساب GL ${glCode} یافت نشد.` });
    const dup = await this.prisma.cashAccount.findFirst({ where: { name } });
    if (dup) throw new BadRequestException({ code: "DUPLICATE", message: "صندوقی با این نام وجود دارد." });
    // projection از مانده دفتری GL شروع می‌شود — نه از صفر و نه از عدد ساختگی
    const opening = await this.glBookBalance(gl.id);
    const acc = await this.prisma.cashAccount.create({
      data: { name, kind, glAccountId: gl.id, openingBalance: opening, currentBalance: opening, active: true },
    });
    await this.audit(input.actorId, "treasury.cash_account.create", "CashAccount", acc.id, { name, kind, glCode });
    return acc;
  }

  async createBankAccount(input: { name: string; bankName: string; accountNumber: string; iban?: string; glAccountCode?: string; openingBalance?: number; actorId?: string }) {
    const name = (input.name ?? "").trim();
    const bankName = (input.bankName ?? "").trim();
    const accountNumber = (input.accountNumber ?? "").trim();
    if (!name || !bankName || !accountNumber) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "نام/بانک/شماره حساب الزامی است." });
    }
    const glCode = input.glAccountCode ?? TreasuryService.GL_BANK;
    const gl = await this.prisma.account.findUnique({ where: { code: glCode } });
    if (!gl) throw new BadRequestException({ code: "GL_MISSING", message: `حساب GL ${glCode} یافت نشد.` });
    const dup = await this.prisma.bankAccount.findFirst({ where: { name } });
    if (dup) throw new BadRequestException({ code: "DUPLICATE", message: "حساب بانکی با این نام وجود دارد." });
    const opening = await this.glBookBalance(gl.id);
    const acc = await this.prisma.bankAccount.create({
      data: { name, bankName, accountNumber, iban: input.iban ?? null, glAccountId: gl.id, openingBalance: opening, currentBalance: opening, active: true },
    });
    await this.audit(input.actorId, "treasury.bank_account.create", "BankAccount", acc.id, { name, bankName, glCode });
    return acc;
  }

  // ---------------- واریز/برداشت/انتقال (بند ۶۱) ----------------

  /** واریز به صندوق/بانک — مقابل پیش‌فرض: سرمایه (واریز مالک)؛ فقط با حساب موجود در COA */
  async cashIn(input: { accountId: string; amount: number; counterAccountCode?: string; description?: string; actorId?: string }) {
    const amount = this.amount(input.amount, "مبلغ");
    const acc = await this.prisma.cashAccount.findUnique({ where: { id: input.accountId } });
    if (!acc || !acc.active) throw new NotFoundException({ code: "NOT_FOUND", message: "صندوق یافت نشد." });
    const glCode = await this.glCodeOf(acc.glAccountId);
    const counterCode = input.counterAccountCode ?? TreasuryService.GL_EQUITY;
    const counter = await this.prisma.account.findUnique({ where: { code: counterCode } });
    if (!counter) throw new BadRequestException({ code: "GL_MISSING", message: `حساب ${counterCode} یافت نشد.` });

    const number = await this.prisma.$transaction(async (tx) => {
      const rcp = await nextNumber(tx, "cash_receipt", "RCP", 6);
      await tx.cashAccount.update({ where: { id: acc.id }, data: { currentBalance: { increment: BigInt(amount) } } });
      await this.journal.postOrNotifyInTx(tx, {
        description: `واریز به ${acc.name} — رسید ${rcp}${input.description ? ` — ${input.description}` : ""}`,
        sourceType: "treasury_cash_in",
        sourceId: acc.id,
        actorId: input.actorId,
        lines: [
          { accountCode: glCode, debit: amount },
          { accountCode: counterCode, credit: amount },
        ],
      });
      return rcp;
    });
    await this.audit(input.actorId, "treasury.cash_in", "CashAccount", acc.id, { amount, number, counterCode });
    return { ok: true, number, balance: await this.cashBalance(acc.id) };
  }

  /** برداشت/هزینه نقدی — مقابل پیش‌فرض: هزینه‌های عملیاتی (6000) */
  async cashOut(input: { accountId: string; amount: number; counterAccountCode?: string; description?: string; actorId?: string }) {
    const amount = this.amount(input.amount, "مبلغ");
    const acc = await this.prisma.cashAccount.findUnique({ where: { id: input.accountId } });
    if (!acc || !acc.active) throw new NotFoundException({ code: "NOT_FOUND", message: "صندوق یافت نشد." });
    const glCode = await this.glCodeOf(acc.glAccountId);
    const counterCode = input.counterAccountCode ?? TreasuryService.GL_EXPENSE;
    const counter = await this.prisma.account.findUnique({ where: { code: counterCode } });
    if (!counter) throw new BadRequestException({ code: "GL_MISSING", message: `حساب ${counterCode} یافت نشد.` });

    const number = await this.prisma.$transaction(async (tx) => {
      const pmt = await nextNumber(tx, "cash_payment", "PMT", 6);
      await this.ensureSufficient(tx, "cashAccount", acc.id, amount, `صندوق «${acc.name}»`);
      await tx.cashAccount.update({ where: { id: acc.id }, data: { currentBalance: { decrement: BigInt(amount) } } });
      await this.journal.postOrNotifyInTx(tx, {
        description: `برداشت از ${acc.name} — سند پرداخت ${pmt}${input.description ? ` — ${input.description}` : ""}`,
        sourceType: "treasury_cash_out",
        sourceId: acc.id,
        actorId: input.actorId,
        lines: [
          { accountCode: counterCode, debit: amount },
          { accountCode: glCode, credit: amount },
        ],
      });
      return pmt;
    });
    await this.audit(input.actorId, "treasury.cash_out", "CashAccount", acc.id, { amount, number, counterCode });
    return { ok: true, number, balance: await this.cashBalance(acc.id) };
  }

  /** انتقال بین حساب‌های خزانه (نقد↔نقد، بانک↔بانک، بانک↔نقد) — یک سند، دو مانده، اتمیک */
  async transfer(input: { fromId: string; toId: string; amount: number; description?: string; actorId?: string }) {
    const amount = this.amount(input.amount, "مبلغ");
    if (input.fromId === input.toId) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "مبدأ و مقصد یکی است." });
    }
    const fromCash = await this.prisma.cashAccount.findUnique({ where: { id: input.fromId } });
    const toCash = await this.prisma.cashAccount.findUnique({ where: { id: input.toId } });
    const fromBank = fromCash ? null : await this.prisma.bankAccount.findUnique({ where: { id: input.fromId } });
    const toBank = toCash ? null : await this.prisma.bankAccount.findUnique({ where: { id: input.toId } });
    const from = fromCash ?? fromBank;
    const to = toCash ?? toBank;
    if (!from || !from.active) throw new NotFoundException({ code: "NOT_FOUND", message: "حساب مبدأ یافت نشد." });
    if (!to || !to.active) throw new NotFoundException({ code: "NOT_FOUND", message: "حساب مقصد یافت نشد." });
    const fromGl = await this.glCodeOf(from.glAccountId);
    const toGl = await this.glCodeOf(to.glAccountId);

    const number = await this.prisma.$transaction(async (tx) => {
      const trf = await nextNumber(tx, "treasury_transfer", "TRF", 6);
      await this.ensureSufficient(tx, fromCash ? "cashAccount" : "bankAccount", from.id, amount, `حساب «${from.name}»`);
      if (fromCash) {
        await tx.cashAccount.update({ where: { id: from.id }, data: { currentBalance: { decrement: BigInt(amount) } } });
      } else {
        await tx.bankAccount.update({ where: { id: from.id }, data: { currentBalance: { decrement: BigInt(amount) } } });
      }
      if (toCash) {
        await tx.cashAccount.update({ where: { id: to.id }, data: { currentBalance: { increment: BigInt(amount) } } });
      } else {
        await tx.bankAccount.update({ where: { id: to.id }, data: { currentBalance: { increment: BigInt(amount) } } });
      }
      // اگر هر دو روی یک GL مشترک‌اند، سند Dr=X/Cr=X بی‌معنی است — فقط جابه‌جایی معین
      if (fromGl !== toGl) {
        await this.journal.postOrNotifyInTx(tx, {
          description: `انتقال خزانه ${trf}: ${from.name} → ${to.name}${input.description ? ` — ${input.description}` : ""}`,
          sourceType: "treasury_transfer",
          sourceId: trf,
          actorId: input.actorId,
          lines: [
            { accountCode: toGl, debit: amount },
            { accountCode: fromGl, credit: amount },
          ],
        });
      }
      return trf;
    });
    await this.audit(input.actorId, "treasury.transfer", "Treasury", `${from.name}→${to.name}`, { amount, number });
    return { ok: true, number };
  }

  // ---------------- هزینه نقدی صندوق POS (بند ۷۲ — petty) ----------------

  /** هزینه نقدی از دراوِر شیفت باز — expenseTotal شیفت + سند Dr 6000 / Cr صندوق؛ اتمیک */
  async posExpense(input: { shiftId: string; amount: number; description?: string; actorId?: string }) {
    const amount = this.amount(input.amount, "مبلغ");
    const shift = await this.prisma.cashierShift.findUnique({ where: { id: input.shiftId } });
    if (!shift || shift.state !== "OPEN") {
      throw new BadRequestException({ code: "SHIFT_NOT_OPEN", message: "شیفت بازی نیست." });
    }
    if (input.actorId && shift.userId !== input.actorId) {
      throw new BadRequestException({ code: "SHIFT_OWNER", message: "این شیفت متعلق به شما نیست." });
    }
    const cash = await this.primaryCashAccount();
    if (!cash) throw new BadRequestException({ code: "NO_CASH_ACCOUNT", message: "صندوق نقد فعالی وجود ندارد." });
    const glCode = await this.glCodeOf(cash.glAccountId);

    const number = await this.prisma.$transaction(async (tx) => {
      const pmt = await nextNumber(tx, "cash_payment", "PMT", 6);
      await this.ensureSufficient(tx, "cashAccount", cash.id, amount, `صندوق نقد`);
      await tx.cashierShift.update({ where: { id: shift.id }, data: { expenseTotal: { increment: BigInt(amount) } } });
      await this.journal.postOrNotifyInTx(tx, {
        description: `هزینه نقدی صندوق — ${pmt}${input.description ? ` — ${input.description}` : ""}`,
        sourceType: "pos_expense",
        sourceId: shift.id,
        actorId: input.actorId,
        lines: [
          { accountCode: TreasuryService.GL_EXPENSE, debit: amount },
          { accountCode: glCode, credit: amount },
        ],
      });
      return pmt;
    });
    await this.audit(input.actorId, "treasury.pos_expense", "CashierShift", shift.id, { amount, number });
    return { ok: true, number };
  }

  /** فهرست هزینه‌های نقدی یک شیفت — از منبع حقیقت: سندهای pos_expense */
  async posExpenses(shiftId: string) {
    const entries = await this.prisma.journalEntry.findMany({
      where: { sourceType: "pos_expense", sourceId: shiftId },
      include: { lines: true },
      orderBy: { date: "desc" },
    });
    return {
      items: entries.map((e) => ({
        id: e.id,
        number: e.number,
        description: e.description,
        amount: e.lines.reduce((acc, l) => acc + Number(l.credit), 0).toString(),
        at: e.date.toISOString(),
      })),
    };
  }

  // ---------------- صورتحساب بانک و مغایرت‌گیری (بند ۶۲) ----------------

  async listStatements(bankAccountId: string) {
    const bank = await this.prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
    if (!bank) throw new NotFoundException({ code: "NOT_FOUND", message: "حساب بانکی یافت نشد." });
    const [items, agg] = await Promise.all([
      this.prisma.bankStatement.findMany({ where: { bankAccountId }, orderBy: { date: "desc" }, take: 200, include: { matches: true } }),
      this.prisma.bankStatement.aggregate({ where: { bankAccountId }, _sum: { amount: true }, _count: true }),
    ]);
    const bookAgg = await this.prisma.journalLine.aggregate({ where: { accountId: bank.glAccountId }, _sum: { debit: true, credit: true } });
    const book = (bookAgg._sum.debit ?? 0n) - (bookAgg._sum.credit ?? 0n);
    const statement = agg._sum.amount ?? 0n;
    return {
      items: items.map((s) => ({
        id: s.id,
        date: s.date.toISOString(),
        amount: s.amount.toString(),
        description: s.description,
        matchedPaymentId: s.matchedPaymentId,
        matches: s.matches.map((m) => ({
          id: m.id,
          sourceType: m.sourceType,
          sourceId: m.sourceId,
          allocatedAmount: m.allocatedAmount.toString(),
          state: m.state,
          note: m.note,
        })),
      })),
      reconciliation: {
        bankAccountId,
        bankName: bank.name,
        glCode: await this.glCodeOf(bank.glAccountId),
        book: book.toString(),
        statement: statement.toString(),
        difference: (book - statement).toString(),
        statementCount: agg._count,
      },
    };
  }

  async importStatements(input: { bankAccountId: string; lines: Array<{ date: string; amount: number; description?: string }>; actorId?: string }) {
    const bank = await this.prisma.bankAccount.findUnique({ where: { id: input.bankAccountId } });
    if (!bank) throw new NotFoundException({ code: "NOT_FOUND", message: "حساب بانکی یافت نشد." });
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "هیچ ردیفی برای وارد کردن نیست." });
    }
    const data = input.lines.map((l) => {
      const amount = Math.round(Number(l.amount));
      if (!Number.isSafeInteger(amount) || amount === 0) {
        throw new BadRequestException({ code: "VALIDATION_ERROR", message: "مبلغ صورتحساب نامعتبر است." });
      }
      const d = new Date(l.date);
      if (Number.isNaN(d.getTime())) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "تاریخ نامعتبر است." });
      return { bankAccountId: bank.id, date: d, amount: BigInt(amount), description: l.description ?? null };
    });
    const r = await this.prisma.bankStatement.createMany({ data });
    await this.audit(input.actorId, "treasury.statement.import", "BankAccount", bank.id, { count: r.count });
    return { ok: true, count: r.count };
  }

  /**
   * مغایرت‌گیری خودکار — فاز ۹ (R3): رفتار قطعی 0/1/N، هرگز first-wins.
   *  0 candidate → UNMATCHED (رها)
   *  1 candidate → AUTO MATCH روی BankStatementMatch (state=MATCHED، matchedPaymentId سازگار پر می‌شود)
   *  N candidate → AMBIGUOUS (رکورد MANUAL_REVIEW، هیچ انتخاب خودکار)
   * اصل بند ۱۴ Design Gate: Match ≠ Clear — تطبیق هیچ تأثیری روی Check/GL/خزانه/settlement ندارد.
   */
  async autoMatch(bankAccountId: string, actorId?: string) {
    const bank = await this.prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
    if (!bank) throw new NotFoundException({ code: "NOT_FOUND", message: "حساب بانکی یافت نشد." });
    const pending = await this.prisma.bankStatement.findMany({ where: { bankAccountId, matchedPaymentId: null } });
    const alreadyMatched = (
      await this.prisma.bankStatement.findMany({ where: { matchedPaymentId: { not: null } }, select: { matchedPaymentId: true } })
    ).map((x) => x.matchedPaymentId as string);
    let autoMatched = 0;
    let ambiguous = 0;
    let unmatched = 0;
    for (const s of pending) {
      if (s.amount < 0n) continue; // بدهی بانکی (کارمزد) با attempt تطبیق نمی‌شود
      const from = new Date(s.date.getTime() - 2 * 86_400_000);
      const to = new Date(s.date.getTime() + 2 * 86_400_000);
      const candidates = await this.prisma.paymentAttempt.findMany({
        where: {
          state: "PAID",
          amount: s.amount,
          verifiedAt: { gte: from, lte: to },
          id: alreadyMatched.length > 0 ? { notIn: alreadyMatched } : undefined,
        },
        orderBy: [{ verifiedAt: "asc" }, { id: "asc" }], // ترتیب فقط برای قطعیت گزارش؛ انتخاب خودکار ممنوع
      });
      if (candidates.length === 1) {
        const cand = candidates[0];
        await this.prisma.$transaction(async (tx) => {
          await tx.bankStatementMatch.create({
            data: {
              statementId: s.id,
              sourceType: "payment_attempt",
              sourceId: cand.id,
              allocatedAmount: s.amount,
              state: "MATCHED",
              actorId: actorId ?? null,
              note: "auto: exactly one candidate",
            },
          });
          await tx.bankStatement.update({ where: { id: s.id }, data: { matchedPaymentId: cand.id } });
        });
        alreadyMatched.push(cand.id);
        autoMatched += 1;
      } else if (candidates.length > 1) {
        // AMBIGUOUS: رکورد MANUAL_REVIEW بدون تخصیص — فقط درخواست بررسی انسانی (idempotent)
        const existingReview = await this.prisma.bankStatementMatch.findFirst({
          where: { statementId: s.id, sourceType: "manual_review", state: "MANUAL_REVIEW" },
        });
        if (!existingReview) {
          await this.prisma.bankStatementMatch.create({
            data: {
              statementId: s.id,
              sourceType: "manual_review",
              sourceId: s.id,
              allocatedAmount: 0n,
              state: "MANUAL_REVIEW",
              actorId: actorId ?? null,
              note: `ambiguous: ${candidates.length} candidates (${candidates.map((c) => c.id).join(",")})`,
            },
          });
        }
        ambiguous += 1;
      } else {
        unmatched += 1;
      }
    }
    await this.audit(actorId, "treasury.statement.match", "BankAccount", bankAccountId, { autoMatched, ambiguous, unmatched });
    return { ok: true, matched: autoMatched, ambiguous, unmatched, pending: unmatched + ambiguous };
  }

  /** تطبیق دستی — فاز ۹: فقط state ثبت می‌شود؛ هیچ GL/خزانه/Check-mutation (Match ≠ Clear) */
  async manualMatch(bankAccountId: string, statementId: string, sourceType: string, sourceId: string, amount: bigint, actorId?: string) {
    if (!(amount > 0n)) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "مبلغ تخصیص باید مثبت باشد." });
    }
    const stmt = await this.prisma.bankStatement.findUnique({ where: { id: statementId } });
    if (!stmt || stmt.bankAccountId !== bankAccountId) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "ردیف صورتحساب یافت نشد." });
    }
    const already = await this.prisma.bankStatementMatch.aggregate({
      where: { statementId, state: { not: "REJECTED" } },
      _sum: { allocatedAmount: true },
    });
    const allocated = already._sum.allocatedAmount ?? 0n;
    const statementAbs = stmt.amount < 0n ? -stmt.amount : stmt.amount;
    if (allocated + amount > statementAbs) {
      throw new BadRequestException({
        code: "ALLOCATION_OVERFLOW",
        message: `مجموع تخصیص (${allocated + amount}) از مبلغ ردیف (${statementAbs}) بیشتر است.`,
      });
    }
    // بدون duplicate allocation به یک source
    const dup = await this.prisma.bankStatementMatch.findUnique({
      where: { statementId_sourceType_sourceId: { statementId, sourceType, sourceId } },
    });
    if (dup && dup.state !== "REJECTED") {
      throw new BadRequestException({ code: "DUPLICATE_ALLOCATION", message: "این منبع قبلاً به این ردیف تخصیص یافته است." });
    }
    const r = await this.prisma.bankStatementMatch.create({
      data: { statementId, sourceType, sourceId, allocatedAmount: amount, state: "MATCHED", actorId: actorId ?? null, note: "manual" },
    });
    await this.audit(actorId, "treasury.statement.manual_match", "BankStatement", statementId, { sourceType, sourceId, amount: amount.toString() });
    return r;
  }

  /** لغو تطبیق — فقط state=REJECTED؛ هیچ اثر مالی (Match ≠ Clear) */
  async unmatch(statementId: string, matchId: string, actorId?: string) {
    const m = await this.prisma.bankStatementMatch.findUnique({ where: { id: matchId } });
    if (!m || m.statementId !== statementId) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "تطبیق یافت نشد." });
    }
    const r = await this.prisma.bankStatementMatch.update({ where: { id: matchId }, data: { state: "REJECTED" } });
    if (m.sourceType === "payment_attempt" && m.state === "MATCHED") {
      await this.prisma.bankStatement.updateMany({ where: { id: statementId, matchedPaymentId: m.sourceId }, data: { matchedPaymentId: null } });
    }
    await this.audit(actorId, "treasury.statement.unmatch", "BankStatement", statementId, { matchId });
    return r;
  }

  // ---------------- اتصال جریان‌های موجود (در-tx) ----------------

  /** صندوق نقد اصلی (GL 1000) — POS/خرید نقدی */
  private async primaryCashAccount() {
    const gl = await this.prisma.account.findUnique({ where: { code: TreasuryService.GL_CASH } });
    if (!gl) return null;
    return this.prisma.cashAccount.findFirst({ where: { glAccountId: gl.id, kind: "cash", active: true }, orderBy: { name: "asc" } });
  }

  /** حساب بانکی اصلی (GL 1100) — پرداخت آنلاین/کارت */
  private async primaryBankAccount() {
    const gl = await this.prisma.account.findUnique({ where: { code: TreasuryService.GL_BANK } });
    if (!gl) return null;
    return this.prisma.bankAccount.findFirst({ where: { glAccountId: gl.id, active: true }, orderBy: { name: "asc" } });
  }

  private async cashBalance(id: string): Promise<string> {
    const a = await this.prisma.cashAccount.findUnique({ where: { id } });
    return (a?.currentBalance ?? 0n).toString();
  }

  /**
   * ثبت فروش POS داخل تراکنش فاکتور: فقط **مانده** صندوق/بانک اتمیک با فاکتور به‌روز می‌شود.
   * سند GL فروش همان‌جا که قبل بود (Dr 1100 / Cr 4000) دست‌نخورده می‌ماند — رفتار GL تغییر نمی‌کند.
   * CASH → صندوق نقد؛ CARD/ONLINE/BANK_TRANSFER → بانک؛ روش‌های نقد‌نشده (CREDIT/CHECK/WALLET) اثر خزانه‌ای ندارند.
   */
  async applyPosSaleInTx(
    tx: Prisma.TransactionClient,
    input: { payments: Array<{ methodCode: string; amount: number }> },
  ): Promise<void> {
    let cashAmt = 0;
    let bankAmt = 0;
    for (const p of input.payments) {
      const m = (p.methodCode || "").toUpperCase();
      const amt = Math.round(Number(p.amount));
      if (m === "CASH") cashAmt += amt;
      else if (m === "CARD" || m === "ONLINE" || m === "BANK_TRANSFER") bankAmt += amt;
    }
    if (cashAmt > 0) {
      const cash = await this.primaryCashAccount();
      if (cash) await tx.cashAccount.update({ where: { id: cash.id }, data: { currentBalance: { increment: BigInt(cashAmt) } } });
    }
    if (bankAmt > 0) {
      const bank = await this.primaryBankAccount();
      if (bank) await tx.bankAccount.update({ where: { id: bank.id }, data: { currentBalance: { increment: BigInt(bankAmt) } } });
    }
  }

  /** دریافت آنلاین — افزایش مانده بانک داخل تراکنش finalize پرداخت (بدون سند؛ سند فروش همان‌جا قبلی باقی است) */
  async creditBankForOnlineInTx(tx: Prisma.TransactionClient, amount: number): Promise<void> {
    const n = Math.round(Number(amount));
    if (!Number.isSafeInteger(n) || n <= 0) return;
    const bank = await this.primaryBankAccount();
    if (!bank) return; // بدون حساب بانکی seedشده — رفتار قبلی حفظ می‌شود
    await tx.bankAccount.update({ where: { id: bank.id }, data: { currentBalance: { increment: BigInt(n) } } });
  }

  /** پرداخت فاکتور خرید داخل همان تراکنش تسویه AP: کاهش مانده + سند Dr AP / Cr نقد-بانک */
  async debitForPurchaseInTx(
    tx: Prisma.TransactionClient,
    input: { method: string; amount: number; invoiceId: string; invoiceNumber: string; actorId?: string },
  ): Promise<void> {
    const amount = Math.round(Number(input.amount));
    if (!Number.isSafeInteger(amount) || amount <= 0) return;
    const isCash = (input.method || "").toLowerCase() === "cash";
    const acc = isCash ? await this.primaryCashAccount() : await this.primaryBankAccount();
    if (!acc) return; // بدون حساب seedشده — سند قبلی همان‌جا بوده و مانده‌ای برای کسر نیست
    const glCode = await this.glCodeOf(acc.glAccountId);
    if (isCash) {
      await tx.cashAccount.update({ where: { id: acc.id }, data: { currentBalance: { decrement: BigInt(amount) } } });
    } else {
      await tx.bankAccount.update({ where: { id: acc.id }, data: { currentBalance: { decrement: BigInt(amount) } } });
    }
    await this.journal.postOrNotifyInTx(tx, {
      description: `پرداخت فاکتور خرید — ${input.invoiceNumber}`,
      sourceType: "purchase_payment",
      sourceId: input.invoiceId,
      actorId: input.actorId,
      lines: [
        { accountCode: "2100", debit: amount },
        { accountCode: glCode, credit: amount },
      ],
    });
  }

  private async audit(actorId: string | undefined, action: string, entity: string, entityId: string, meta: Record<string, unknown>): Promise<void> {
    await this.prisma.auditLog
      .create({
        data: { actorId: actorId ?? null, action, entity, entityId, newValues: meta as object },
      })
      .catch(() => undefined); // audit خارج از تراکنش — حیاتی نیست (سند و مانده ثبت شده‌اند)
  }
}
