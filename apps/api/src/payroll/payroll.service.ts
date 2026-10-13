import { BadRequestException, forwardRef, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JournalService } from "../accounting/journal.service";
import { GL, GL_EXPENSE, GL_LIABILITIES } from "@ghasedak/contracts";

/**
 * حقوق خودکار — گام ۷ فاز ۲.
 *
 * خواستهٔ کاربر: «خودکار بشه، چطور میشه دستی باشه؟» — یعنی کنترل دستی بماند
 * ولی کار تکراری ماهانه خودکار شود. اینجا دقیقاً همان است:
 *
 *   ۱) یک‌بار برای هر کارمند «قرارداد حقوق» تعریف می‌شود (فیش حقوقی)
 *   ۲) هر ماه یک دکمه: لیست را می‌سازد و **پیش‌نویس** می‌دهد
 *   ۳) مدیر می‌تواند هر ردیف را تغییر دهد یا کل لیست را دستی وارد کند
 *   ۴) با «ثبت سند» یک سند می‌زند:
 *
 *        Dr 6000-04 حقوق و دستمزد      = جمع ناخالص
 *           Cr 2101 حقوق پرداختنی کارکنان = جمع خالص
 *        (اگر کسی بیمه/پیش‌پرداخت کنده باشد، خط کسر جدا می‌افتد)
 *
 * حساب بدهی کارکنان `2101` است تا از بدهی تأمین‌کننده (`2100`) جدا باشد —
 * قاطی شدنشان یعنی گزارش بدهی‌ها بی‌معنا می‌شود.
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => JournalService)) private readonly journal: JournalService,
  ) {}

  /** حساب بستانکار حقوق — از حساب پرداختنی فروشندگان جداست */
  private static readonly PAYABLE_SALARY = "2101";

  // ---------------- قراردادهای حقوق ----------------

  async listContracts(activeOnly = true) {
    return this.prisma.payrollContract.findMany({
      where: activeOnly ? { active: true } : {},
      orderBy: [{ active: "desc" }, { startDate: "desc" }],
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    });
  }

  /**
   * ثبت/به‌روزرسانی قرارداد حقوق.
   *
   * اگر کارمند قرارداد فعال دارد، همان به‌روزرسانی می‌شود (نه رکورد جدید) تا
   * سابقهٔ حقوق‌های پرداخت‌شده مبهم نشود.
   */
  async saveContract(input: {
    userId: string;
    baseSalary: number;
    housingAllowance?: number;
    childAllowance?: number;
    transportAllowance?: number;
    otherAllowance?: number;
    deduction?: number;
    insuranceDeduction?: number;
    startDate?: string;
    note?: string;
  }) {
    const gross =
      num(input.baseSalary) +
      num(input.housingAllowance) +
      num(input.childAllowance) +
      num(input.transportAllowance) +
      num(input.otherAllowance);
    const total = gross - num(input.deduction) - num(input.insuranceDeduction);

    if (gross <= 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "حقوق پایه باید بیشتر از صفر باشد." });
    }
    if (total < 0) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "کسورات از حقوق ناخالص بیشتر است.",
      });
    }

    const user = await this.prisma.user.findUnique({ where: { id: input.userId }, select: { id: true } });
    if (!user) throw new NotFoundException({ code: "NOT_FOUND", message: "کارمند یافت نشد." });

    const existing = await this.prisma.payrollContract.findFirst({
      where: { userId: input.userId, active: true },
    });
    const data = {
      baseSalary: BigInt(num(input.baseSalary)),
      housingAllowance: BigInt(num(input.housingAllowance)),
      childAllowance: BigInt(num(input.childAllowance)),
      transportAllowance: BigInt(num(input.transportAllowance)),
      otherAllowance: BigInt(num(input.otherAllowance)),
      deduction: BigInt(num(input.deduction)),
      insuranceDeduction: BigInt(num(input.insuranceDeduction)),
      startDate: input.startDate ? new Date(input.startDate) : new Date(),
      note: input.note ?? null,
    };

    if (existing) {
      return this.prisma.payrollContract.update({ where: { id: existing.id }, data });
    }
    return this.prisma.payrollContract.create({ data: { ...data, userId: input.userId, active: true } });
  }

  async endContract(id: string) {
    return this.prisma.payrollContract.update({
      where: { id },
      data: { active: false, endDate: new Date() },
    });
  }

  // ---------------- لیست حقوق ماه ----------------

  /**
   * ساخت (یا بازسازی) لیست یک ماه از قراردادهای فعال.
   *
   * اگر ماه قبلاً `POSTED` شده باشد دست نمی‌خورد — حقوق پرداخت‌شده نباید
   * بی‌صدا بازنویسی شود.
   */
  async buildRun(period: string, title?: string) {
    const p = period.trim();
    if (!/^\d{4}\/\d{2}$/.test(p)) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "دوره باید به شکل ۱۴۰۴/۰۵ باشد (سال/ماه).",
      });
    }

    const existing = await this.prisma.payrollRun.findUnique({ where: { period: p } });
    if (existing?.state === "POSTED") {
      throw new BadRequestException({
        code: "PAYROLL_ALREADY_POSTED",
        message: `حقوق ${p} قبلاً با سند حسابداری ثبت شده است. برای اصلاح، ابتدا سند را برگردانید.`,
      });
    }

    const contracts = await this.prisma.payrollContract.findMany({
      where: { active: true },
      include: { user: { select: { id: true, name: true } } },
    });
    if (contracts.length === 0) {
      throw new BadRequestException({
        code: "NO_CONTRACTS",
        message: "هیچ قرارداد حقوق فعالی تعریف نشده است. اول برای کارکنان حقوق تعریف کنید.",
      });
    }

    const rows = contracts.map((c) => {
      const gross =
        Number(c.baseSalary) +
        Number(c.housingAllowance) +
        Number(c.childAllowance) +
        Number(c.transportAllowance) +
        Number(c.otherAllowance);
      const deduction = Number(c.deduction) + Number(c.insuranceDeduction);
      return { userId: c.userId, name: c.user.name, gross, deduction, net: gross - deduction };
    });

    const totalGross = rows.reduce((s, r) => s + r.gross, 0);
    const totalDeduction = rows.reduce((s, r) => s + r.deduction, 0);
    const totalNet = rows.reduce((s, r) => s + r.net, 0);

    if (existing) {
      // بازسازی پیش‌نویس ماه (کنترل دستی مدیر حفظ می‌شود چون خودش می‌تواند
      // بعد از ساخت، ردیف‌ها را ویرایش کند و دوباره ذخیره بزند)
      await this.prisma.payrollItem.deleteMany({ where: { runId: existing.id } });
      await this.prisma.payrollItem.createMany({
        data: rows.map((r) => ({
          runId: existing.id,
          userId: r.userId,
          period: p,
          gross: BigInt(r.gross),
          deduction: BigInt(r.deduction),
          net: BigInt(r.net),
        })),
        skipDuplicates: true,
      });
      await this.recalcTotals(existing.id);
      if (title) {
        await this.prisma.payrollRun.update({ where: { id: existing.id }, data: { title } });
      }
      return this.getRun(existing.id);
    }

    const run = await this.prisma.payrollRun.create({
      data: {
        period: p,
        title: title ?? `حقوق ${p}`,
        totalGross: BigInt(totalGross),
        totalDeduction: BigInt(totalDeduction),
        totalNet: BigInt(totalNet),
      },
    });
    await this.prisma.payrollItem.createMany({
      data: rows.map((r) => ({
        runId: run.id,
        userId: r.userId,
        period: p,
        gross: BigInt(r.gross),
        deduction: BigInt(r.deduction),
        net: BigInt(r.net),
      })),
      skipDuplicates: true,
    });
    return this.getRun(run.id);
  }

  async getRun(id: string) {
    const run = await this.prisma.payrollRun.findUnique({
      where: { id },
      include: {
        items: {
          orderBy: { net: "desc" },
          include: { user: { select: { id: true, name: true, role: true } } },
        },
      },
    });
    if (!run) throw new NotFoundException({ code: "NOT_FOUND", message: "لیست حقوق یافت نشد." });
    return {
      ...run,
      totalGross: Number(run.totalGross),
      totalDeduction: Number(run.totalDeduction),
      totalNet: Number(run.totalNet),
      items: run.items.map((i) => ({
        ...i,
        gross: Number(i.gross),
        deduction: Number(i.deduction),
        net: Number(i.net),
      })),
    };
  }

  async listRuns() {
    const rows = await this.prisma.payrollRun.findMany({
      orderBy: { period: "desc" },
      include: { _count: { select: { items: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      period: r.period,
      title: r.title,
      state: r.state,
      employeeCount: r._count.items,
      totalNet: Number(r.totalNet),
      postedAt: r.postedAt?.toISOString() ?? null,
      journalEntryId: r.journalEntryId,
    }));
  }

  /** ویرایش دستی یک ردیف — همان کنترلی که خواستید بماند */
  async updateItem(itemId: string, input: { gross?: number; deduction?: number }) {
    const item = await this.prisma.payrollItem.findUnique({
      where: { id: itemId },
      include: { run: { select: { state: true, period: true } } },
    });
    if (!item) throw new NotFoundException({ code: "NOT_FOUND", message: "ردیف حقوق یافت نشد." });
    if (item.run.state === "POSTED") {
      throw new BadRequestException({
        code: "PAYROLL_ALREADY_POSTED",
        message: "این لیست با سند حسابداری ثبت شده و قابل ویرایش نیست.",
      });
    }
    const gross = input.gross !== undefined ? num(input.gross) : Number(item.gross);
    const deduction = input.deduction !== undefined ? num(input.deduction) : Number(item.deduction);
    if (gross - deduction < 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "کسورات از حقوق ناخالص بیشتر است." });
    }
    await this.prisma.payrollItem.update({
      where: { id: itemId },
      data: { gross: BigInt(gross), deduction: BigInt(deduction), net: BigInt(gross - deduction) },
    });
    await this.recalcTotals(item.runId);
    // شکل پاسخ را مثل بقیهٔ متدها نرمال می‌کنیم (BigInt → number)، وگرنه
    // UI با `BigInt` طرف می‌ماند و JSON.stringify خطا می‌دهد.
    return this.getRun(item.runId);
  }

  private async recalcTotals(runId: string) {
    const items = await this.prisma.payrollItem.findMany({ where: { runId } });
    const g = items.reduce((s, i) => s + Number(i.gross), 0);
    const d = items.reduce((s, i) => s + Number(i.deduction), 0);
    return this.prisma.payrollRun.update({
      where: { id: runId },
      data: { totalGross: BigInt(g), totalDeduction: BigInt(d), totalNet: BigInt(g - d) },
    });
  }

  async deleteRun(id: string) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id }, select: { state: true } });
    if (!run) throw new NotFoundException({ code: "NOT_FOUND", message: "لیست حقوق یافت نشد." });
    if (run.state === "POSTED") {
      throw new BadRequestException({
        code: "PAYROLL_ALREADY_POSTED",
        message: "این لیست با سند حسابداری ثبت شده و قابل حذف نیست.",
      });
    }
    await this.prisma.payrollRun.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * ثبت سند حقوق — تنها نقطه‌ای که پول جابه‌جا می‌شود.
   *
   *   Dr 6000-04 هزینهٔ حقوق و دستمزد   = جمع ناخالص
   *   Cr 2101 حقوق پرداختنی کارکنان     = جمع خالص
   *
   * کسورات (بیمه و…) در همان سند بدهکار `6000-04` می‌شود و بستانکاری‌اش
   * جداگانه نمی‌شود چون از حقوق ما کسر و به بیمه پرداخت می‌شود — همان هزینه
   * است، فقط بخشی از آن به‌جای کارمند به بیمه‌گر می‌رود.
   *
   * اگر `cashAccountId` داده شود، بدهی کارکنان بلافاصله به صندوق پرداخت
   * می‌شود (Dr 1000 / Cr 2101) — یعنی حقوق واقعاً از جیب خارج شد.
   */
  async postJournal(runId: string, actorId?: string, cashAccountId?: string) {
    const run = await this.prisma.payrollRun.findUnique({
      where: { id: runId },
      include: { items: true },
    });
    if (!run) throw new NotFoundException({ code: "NOT_FOUND", message: "لیست حقوق یافت نشد." });
    if (run.state === "POSTED") {
      throw new BadRequestException({
        code: "PAYROLL_ALREADY_POSTED",
        message: "برای این ماه قبلاً سند حسابداری ثبت شده است.",
      });
    }
    if (run.items.length === 0) {
      throw new BadRequestException({ code: "EMPTY_RUN", message: "لیست حقوق خالی است." });
    }

    const gross = Number(run.totalGross);
    const net = Number(run.totalNet);
    const deduction = gross - net; // بیمه و پیش‌پرداخت کارمند
    if (gross <= 0 || net < 0) {
      throw new BadRequestException({ code: "INVALID_RUN", message: "مبالغ لیست حقوق معتبر نیست." });
    }

    // حساب بستانکار حقوق باید وجود داشته باشد؛ اگر نیست، همان‌جا می‌سازیم
    const payable = await this.prisma.account.findUnique({ where: { code: PayrollService.PAYABLE_SALARY } });
    if (!payable) {
      throw new BadRequestException({
        code: "GL_MISSING",
        message: `حساب ${PayrollService.PAYABLE_SALARY} (حقوق پرداختنی کارکنان) تعریف نشده است.`,
      });
    }

    /**
     * سند حقوق:
     *   Dr 6000-04 هزینهٔ حقوق و دستمزد   = ناخالص (کل هزینهٔ شرکت)
     *      Cr 2101 حقوق پرداختنی کارکنان   = خالص (آنچه به کارمند می‌رسد)
     *      Cr 2101 بیمه/پیش‌پرداخت          = کسورات (فعلاً به کارمند می‌ماند
     *                                          تا وقتی به بیمه‌گر پرداخت شود)
     *
     * نکتهٔ توازن: Dr باید = مجموع Crها. با درآوردن کسورات از بدهکارِ کارمند
     * و گذاشتنش به‌عنوان بستانکار جدا، جمع درست می‌شود. اگر کسورات را
     * اصلاً ننویسیم، سند نامتوازن می‌شود — و این دقیقاً همان باگی است که
     * تست گرفت.
     */
    const lines: Array<{ accountCode: string; debit?: number; credit?: number }> = [
      { accountCode: GL_EXPENSE.SALARY, debit: gross },
      { accountCode: PayrollService.PAYABLE_SALARY, credit: net },
    ];
    if (deduction > 0) {
      lines.push({ accountCode: PayrollService.PAYABLE_SALARY, credit: deduction });
    }
    // اگر خواستیم حقوق را همان لحظه نقد پرداخت کنیم
    if (cashAccountId && net > 0) {
      const cash = await this.prisma.cashAccount.findUnique({ where: { id: cashAccountId } });
      if (!cash || !cash.active) {
        throw new NotFoundException({ code: "NOT_FOUND", message: "صندوق یافت نشد." });
      }
      const glCode = await this.glCodeOf(cash.glAccountId);
      lines.push({ accountCode: glCode, debit: net });
      lines.push({ accountCode: PayrollService.PAYABLE_SALARY, credit: net });
    }

    const entry = await this.journal.post({
      description: `حقوق و دستمزد ${run.title}`,
      sourceType: "payroll",
      sourceId: run.id,
      actorId,
      lines,
    });

    await this.prisma.payrollRun.update({
      where: { id: runId },
      data: {
        state: "POSTED",
        journalEntryId: entry.id,
        postedAt: new Date(),
        postedById: actorId ?? null,
      },
    });

    return { ok: true, journalNumber: entry.number, runId };
  }

  private async glCodeOf(glAccountId: string | null): Promise<string> {
    if (!glAccountId) return GL.CASH;
    const row = await this.prisma.account.findUnique({ where: { id: glAccountId }, select: { code: true } });
    return row?.code ?? GL.CASH;
  }

  /** حساب‌های پیش‌فرض حقوق — برای راهنمای UI */
  accounts() {
    return {
      expense: GL_EXPENSE.SALARY,
      payable: PayrollService.PAYABLE_SALARY,
    };
  }
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}