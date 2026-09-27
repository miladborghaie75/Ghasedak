import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JournalService } from "../accounting/journal.service";

/**
 * فاز ۹ — Wave 2: سرویس دامنهٔ چک (بند ۱۳/۱۴ Design Gate)
 *
 * اصول غیرقابل نقض:
 *  - Lifecycle فقط با allow-list — هیچ transition دلخواهی مجاز نیست.
 *  - هر transition: validate وضعیت فعلی/مقصد + optimistic concurrency (lifecycleVersion CAS)
 *    + idempotencyKey + CheckTransition unique(checkId,version) + atomicity تراکنش.
 *  - Match ≠ Clear — تطبیق صورتحساب بانکی هرگز چک را clear نمی‌کند؛ فقط clearing صریح.
 *  - Clearing فقط یک‌بار (idempotent): RECEIVED → Dr 1100/Cr 1220؛ ISSUED → Dr 2110/Cr 1100.
 *    مانده بانک (projection خزانه) هم فقط در همان تراکنش و فقط در clearing تغییر می‌کند.
 *  - Bounce/Return: برگشت اثر وصول فقط اگر واقعاً قبلاً cleared شده باشد؛ duplicate ممنوع؛
 *    مطالبهٔ دوباره به‌صورت AR TRADE (1210) یا بدهی تامین‌کننده (2100) برمی‌گردد — هیچ GL اضافی نمی‌ماند.
 *  - شکست سند هرگز بی‌صدا نیست — postOrNotifyInTx (خطا → rollback کامل + Notification/Audit).
 *  - همهٔ رویدادها در-tx روی DomainEventOutbox با @@unique(name,payload) — consumer idempotent.
 */

/**
 * allow-list lifecycle — بند ۱۳ Design Gate + STEP 6 (برگشت پس از وصول):
 * CLEARED → BOUNCED مجاز است (برگشت در وصول؛ چون «پایان» نیست تا زمانی که وجه واقعاً قطعی شود)؛
 * BOUNCED/RETURNED/CANCELLED پایانی‌اند.
 */
const RECEIVED_TRANSITIONS: Record<string, string[]> = {
  RECEIVED: ["DEPOSITED", "CLEARED", "BOUNCED", "RETURNED"],
  DEPOSITED: ["CLEARED", "BOUNCED", "RETURNED"],
  CLEARED: ["BOUNCED"], // برگشت پس از وصول (chargeback) — STEP 6
  BOUNCED: [], // terminal
  RETURNED: [], // terminal
};

const ISSUED_TRANSITIONS: Record<string, string[]> = {
  ISSUED: ["PRESENTED", "CLEARED", "BOUNCED", "CANCELLED"],
  PRESENTED: ["CLEARED", "BOUNCED"],
  CLEARED: ["BOUNCED"], // برگشت پس از وصول — STEP 6
  BOUNCED: [], // terminal
  CANCELLED: [], // terminal
};

/** وضعیت‌های نهایی — هیچ گذار خروجی از آن‌ها مجاز نیست */


const GL_CHECK_RECEIVABLE = "1220";
const GL_AR_TRADE = "1210";
const GL_BANK = "1100";
const GL_AP = "2100";
const GL_OUTSTANDING_PAYABLE = "2110";

export interface TransitionInput {
  checkId: string;
  toStatus: string;
  idempotencyKey: string;
  actorId?: string;
  reason?: string;
  requestId?: string;
  /** تاریخ واقعی وصول/برگشت برای سند خزانه */
  effectiveAt?: Date;
  /** شناسه ردیف صورتحساب بانکی که clearing از آن تأیید می‌شود (فقط audit) */
  bankStatementId?: string;
}

/** وضعیت‌های چک که در «مبلغ پرداخت مؤثر» خرید (STEP 4) و تسویهٔ AR (STEP 7) می‌شمارند */
export const CHECK_EFFECTIVE_STATUSES = ["RECEIVED", "DEPOSITED", "ISSUED", "PRESENTED", "CLEARED"] as const;

@Injectable()
export class ChecksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: JournalService,
  ) {}

  private allowListFor(direction: string): Record<string, string[]> {
    return direction === "ISSUED" ? ISSUED_TRANSITIONS : RECEIVED_TRANSITIONS;
  }

  /** فهرست مجاز transitionها از وضعیت فعلی — برای UI و validation */
  allowedTargets(check: { direction: string; status: string }): string[] {
    return this.allowListFor(check.direction)[check.status] ?? [];
  }

  // ---------------- پرسش و فهرست ----------------

  async get(id: string) {
    const check = await this.prisma.check.findUnique({
      where: { id },
      include: {
        transitions: { orderBy: { version: "desc" } },
        posPayment: { select: { id: true, invoiceId: true } },
        purchasePayment: { select: { id: true, invoiceId: true } },
        statementMatches: { select: { id: true, statementId: true, state: true, allocatedAmount: true } },
      },
    });
    if (!check) throw new NotFoundException({ code: "NOT_FOUND", message: "چک یافت نشد." });
    return { check, allowedTargets: this.allowedTargets(check) };
  }

  async list(filter: { status?: string; direction?: string; dueBefore?: string; take?: number }) {
    const where: Prisma.CheckWhereInput = {};      if (filter.status) where.status = filter.status as never; // eslint-disable-line
    if (filter.direction) where.direction = filter.direction as never;
    if (filter.dueBefore) where.dueDate = { lte: new Date(filter.dueBefore) };
    const items = await this.prisma.check.findMany({
      where,
      orderBy: { dueDate: "asc" },
      take: Math.min(Math.max(filter.take ?? 100, 1), 200),
      include: {
        transitions: { orderBy: { version: "desc" }, take: 1 },
        customer: { select: { id: true, name: true, mobile: true } },
        supplier: { select: { id: true, name: true } },
      },
    });
    return { items };
  }

  // ---------------- ایجاد (مستقیم — POS/خرید مسیر in-tx خودشان را دارند) ----------------

  /**
   * ایجاد چک مستقل (AR-محور). برای POS/خرید، سرویس مربوطه در همان تراکنش چک می‌سازد —
   * این متد فقط برای گردش مستقل چک (بند ۱۳: Customer → AR → Check Receivable) است.
   */
  async create(input: {
    direction: "RECEIVED" | "ISSUED";
    number: string;
    bankName: string;
    amount: number;
    dueDate: Date;
    issueDate?: Date;
    branch?: string;
    accountNo?: string;
    drawer?: string;
    payee?: string;
    customerId?: string;
    supplierId?: string;
    /** حساب بانکی خزانه برای clearing آینده — اگر ست نشود، بانک اصلی (GL 1100) استفاده می‌شود */
    treasuryBankAccountId?: string;
    idempotencyKey?: string;
    notes?: string;
    actorId?: string;
  }) {
    const amount = Math.round(Number(input.amount));
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "مبلغ چک نامعتبر است." });
    }
    if (!input.number?.trim() || !input.bankName?.trim()) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "شماره چک و نام بانک الزامی است." });
    }
    if (input.direction === "RECEIVED" && !input.customerId) {
      throw new BadRequestException({ code: "CHECK_CUSTOMER_REQUIRED", message: "چک دریافتی بدون مشتری مجاز نیست." });
    }
    if (input.direction === "ISSUED" && !input.supplierId) {
      throw new BadRequestException({ code: "CHECK_SUPPLIER_REQUIRED", message: "چک صادره بدون تامین‌کننده مجاز نیست." });
    }

    // idempotency: کلید یکسان → همان چک موجود (هیچ ردیف دومی ساخته نمی‌شود)
    if (input.idempotencyKey) {
      const existing = await this.prisma.check.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return existing;
    }

    return this.prisma.$transaction(async (tx) => {
      const check = await tx.check.create({
        data: {
          direction: input.direction,
          status: input.direction as never, // RECEIVED check → RECEIVED؛ ISSUED check → ISSUED
          number: input.number.trim(),
          bankName: input.bankName.trim(),
          branch: input.branch ?? null,
          accountNo: input.accountNo ?? null,
          amount: BigInt(amount),
          issueDate: input.issueDate ?? new Date(),
          dueDate: input.dueDate,
          drawer: input.drawer ?? null,
          payee: input.payee ?? null,
          sourceType: "manual",
          customerId: input.customerId ?? null,
          supplierId: input.supplierId ?? null,
          treasuryBankAccountId: input.treasuryBankAccountId ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          notes: input.notes ?? null,
        },
      });
      await tx.checkTransition.create({
        data: { checkId: check.id, version: 0, fromStatus: null, toStatus: check.status as never, idempotencyKey: `${check.id}:v0`, actorId: input.actorId ?? null, reason: "created" },
      });
      await tx.domainEventOutbox.create({
        data: { name: "CheckCreated", payload: { checkId: check.id, direction: check.direction, amount, sourceType: "manual" } as never },
      });
      // STEP 7: چک دریافتی = موضع مشتری → ردیف AR CHECK (مشتری → AR → Check Receivable)
      if (check.direction === "RECEIVED" && check.customerId) {
        await this.ensureArCheckRowInTx(tx, { checkId: check.id, customerId: check.customerId, amount: check.amount, dueDate: check.dueDate });
      }
      return check;
    });
  }

  // ---------------- ایجاد درون-تراکنشی برای POS/خرید (الگوی Existing Capability First) ----------------

  /**
   * چک دریافتی POS — توسط pos.service داخل تراکنش فاکتور صدا زده می‌شود.
   * Check + CheckTransition(v0) + CheckCreated outbox + ردیف AR CHECK — همه در همان tx.
   * هیچ اثر خزانه‌ای ندارد (چک هنوز وصول نشده) و revenue هم اینجا ساخته نمی‌شود (فروش همان‌جا قبلی).
   */
  async createReceivedInTx(
    tx: Prisma.TransactionClient,
    input: {
      number: string; bankName: string; amount: bigint; dueDate: Date; issueDate?: Date;
      drawer?: string | null; customerId: string; customerName?: string | null;
      sourceType: string; sourceId: string; idempotencyKey?: string; actorId?: string;
    },
  ) {
    // idempotency: کلید یکسان → همان چک (replay تراکنش POS نباید چک دوم بسازد)
    if (input.idempotencyKey) {
      const existing = await tx.check.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return existing;
    }
    const check = await tx.check.create({
      data: {
        direction: "RECEIVED",
        status: "RECEIVED",
        number: input.number || "—",
        bankName: input.bankName || "—",
        amount: input.amount,
        issueDate: input.issueDate ?? new Date(),
        dueDate: input.dueDate,
        drawer: input.drawer ?? null,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        customerId: input.customerId,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });
    await tx.checkTransition.create({
      data: { checkId: check.id, version: 0, fromStatus: null, toStatus: "RECEIVED", idempotencyKey: `${check.id}:v0`, actorId: input.actorId ?? null, reason: `created via ${input.sourceType}` },
    });
    await tx.domainEventOutbox.create({
      data: { name: "CheckCreated", payload: { checkId: check.id, direction: "RECEIVED", amount: Number(input.amount), sourceType: input.sourceType, sourceId: input.sourceId, actorId: input.actorId ?? null } as never },
    });
    // AR CHECK — موضع بدهی مشتری پشت چک (همان مبلغ؛ double-count ممنوع — وصول → SETTLED همین ردیف)
    await this.ensureArCheckRowInTx(tx, { checkId: check.id, customerId: input.customerId, amount: input.amount, dueDate: input.dueDate });
    return check;
  }

  /**
   * چک صادره به تامین‌کننده — توسط purchasing.service داخل تراکنش پرداخت صدا زده می‌شود.
   * صدور: Dr 2100 / Cr 2110؛ بانک دست نمی‌خورد (کاهش بانک فقط در clearing).
   */
  async createIssuedInTx(
    tx: Prisma.TransactionClient,
    input: {
      number: string; bankName: string; amount: bigint; dueDate: Date; issueDate?: Date;
      payee?: string | null; supplierId: string; sourceType: string; sourceId: string;
      idempotencyKey?: string; actorId?: string;
    },
  ) {
    if (input.idempotencyKey) {
      const existing = await tx.check.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return existing;
    }
    const check = await tx.check.create({
      data: {
        direction: "ISSUED",
        status: "ISSUED",
        number: input.number || "—",
        bankName: input.bankName || "—",
        amount: input.amount,
        issueDate: input.issueDate ?? new Date(),
        dueDate: input.dueDate,
        payee: input.payee ?? null,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        supplierId: input.supplierId,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });
    const transition = await tx.checkTransition.create({
      data: { checkId: check.id, version: 0, fromStatus: null, toStatus: "ISSUED", idempotencyKey: `${check.id}:v0`, actorId: input.actorId ?? null, reason: `created via ${input.sourceType}` },
    });
    await tx.domainEventOutbox.create({
      data: { name: "CheckCreated", payload: { checkId: check.id, direction: "ISSUED", amount: Number(input.amount), sourceType: input.sourceType, sourceId: input.sourceId, actorId: input.actorId ?? null } as never },
    });
    const entry = await this.journal.postOrNotifyInTx(tx, {
      description: `صدور چک ${check.number} — ${check.bankName}`,
      sourceType: "check_transition",
      sourceId: `${check.id}:ISSUED`,
      actorId: input.actorId,
      lines: [
        { accountCode: GL_AP, debit: Number(input.amount) },
        { accountCode: GL_OUTSTANDING_PAYABLE, credit: Number(input.amount) },
      ],
    });
    await tx.checkTransition.update({ where: { id: transition.id }, data: { journalEntryId: entry.id } });
    return check;
  }

  /** ردیف AR CHECK برای چک دریافتی — فقط با معین واقعی مشتری (بدون داده فیک) */
  private async ensureArCheckRowInTx(tx: Prisma.TransactionClient, input: { checkId: string; customerId: string; amount: bigint; dueDate: Date }) {
    let ca = await tx.customerAccount.findUnique({ where: { customerId: input.customerId } });
    if (!ca) {
      ca = await tx.customerAccount.create({ data: { customerId: input.customerId } });
    }
    const dup = await tx.accountsReceivable.findFirst({ where: { refType: "check", refId: input.checkId, exposureType: "CHECK" } });
    if (dup) return;
    await tx.accountsReceivable.create({
      data: { accountPId: ca.id, refType: "check", refId: input.checkId, exposureType: "CHECK", amount: input.amount, state: "OPEN", dueDate: input.dueDate },
    });
    await tx.customerAccount.update({ where: { id: ca.id }, data: { outstanding: { increment: input.amount } } });
  }

  // ---------------- lifecycle transition ----------------

  /**
   * transition با CAS: update شرطی روی lifecycleVersion — اگر دو request همزمان برسند
   * فقط یکی version را می‌بَرد و transition واقعی می‌سازد؛ دیگری CONCURRENT_MODIFICATION
   * (تغییر version توسط request دیگر) یا INVALID_TRANSITION (اجازهٔ allow-list) می‌گیرد —
   * تفکیک با re-read بعد از شکست CAS، نه با حدسِ اولیه (Wave 3 STEP 3).
   * idempotencyKey تکراری → همان transition قبلی (replay، بدون اثر دوم).
   */
  async transition(input: TransitionInput) {
    return this.prisma.$transaction(async (tx) => {
      // idempotency — کلید تکراری → همان transition قبلی (بدون اثر دوم)
      const dup = await tx.checkTransition.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (dup) {
        const check = await tx.check.findUnique({ where: { id: input.checkId } });
        if (!check) throw new NotFoundException({ code: "NOT_FOUND", message: "چک یافت نشد." });
        return { replayed: true as const, check, transition: dup };
      }

      const check = await tx.check.findUnique({ where: { id: input.checkId } });
      if (!check) throw new NotFoundException({ code: "NOT_FOUND", message: "چک یافت نشد." });

      const allowed = this.allowListFor(check.direction)[check.status] ?? [];
      if (!allowed.includes(input.toStatus)) {
        throw new BadRequestException({
          code: "INVALID_TRANSITION",
          message: `گذار ${check.status} → ${input.toStatus} برای چک ${check.direction} مجاز نیست (مجاز: ${allowed.join("، ") || "هیچ"}).`,
        });
      }
      // وضعیت‌های پایانی خودشان در allow-list آرایهٔ خالی دارند (BOUNCED/RETURNED/CANCELLED)
      // — منبع حقیقتِ تک: همان allow-list؛ هیچ گارد دومِ موازی‌ای لازم نیست.

      const targetVersion = check.lifecycleVersion + 1;
      // CAS — ردیف فقط با version فعلی به‌روز می‌شود؛ race → count=0 → تفکیک دقیق نوع تعارض
      const updated = await tx.check.updateMany({
        where: { id: check.id, lifecycleVersion: check.lifecycleVersion },
        data: { status: input.toStatus as never, lifecycleVersion: targetVersion },
      });
      if (updated.count !== 1) {
        // فاز ۹ — Wave 3 (STEP 3): تفکیک CONCURRENT_MODIFICATION از INVALID_TRANSITION.
        // در READ COMMITTED هر دو tx ممکن است قبل از CAS وضعیت مشابه ببینند؛ پاسخ درست با
        // re-read بعد از شکست CAS مشخص می‌شود:
        //  - version تغییر کرده (request دیگری transition را برده) → CONCURRENT_MODIFICATION
        //  - version همان است اما allow-list اجازه نمی‌دهد (state از مسیر دیگری عوض شده) → INVALID_TRANSITION
        const fresh = await tx.check.findUnique({ where: { id: check.id }, select: { lifecycleVersion: true, status: true } });
        if (fresh && fresh.lifecycleVersion !== check.lifecycleVersion) {
          throw new ConflictException({
            code: "CONCURRENT_MODIFICATION",
            message: `وضعیت چک همزمان تغییر کرده (نسخهٔ ${check.lifecycleVersion} → ${fresh.lifecycleVersion}) — دوباره تلاش کنید.`,
          });
        }
        throw new BadRequestException({
          code: "INVALID_TRANSITION",
          message: `گذار ${check.status} → ${input.toStatus} مجاز نیست.`,
        });
      }

      // اثر حسابداری/خزانه‌ای/AR داخل همان تراکنش — شکست ⇒ rollback کل transition
      const journalEntryId = await this.applyEffectsInTx(tx, check, input);

      const transition = await tx.checkTransition.create({
        data: {
          checkId: check.id,
          version: targetVersion,
          fromStatus: check.status as never,
          toStatus: input.toStatus as never,
          idempotencyKey: input.idempotencyKey,
          actorId: input.actorId ?? null,
          reason: input.reason ?? null,
          requestId: input.requestId ?? null,
          journalEntryId: journalEntryId ?? null,
        },
      });

      // رویدادها در-tx: عمومی (CheckTransitioned) + اختصاصی برای مصرف‌کننده‌ها
      const specific = input.toStatus === "CLEARED" ? "CheckCleared" : input.toStatus === "BOUNCED" ? "CheckBounced" : input.toStatus === "CANCELLED" ? "CheckCancelled" : null;
      const basePayload = { checkId: check.id, direction: check.direction, amount: Number(check.amount), from: check.status, to: input.toStatus, version: targetVersion, transitionId: transition.id, actorId: input.actorId ?? null };
      await tx.domainEventOutbox.create({ data: { name: "CheckTransitioned", payload: basePayload as never } });
      if (specific) {
        await tx.domainEventOutbox.create({ data: { name: specific, payload: basePayload as never } });
      }

      return { replayed: false as const, check: { ...check, status: input.toStatus, lifecycleVersion: targetVersion }, transition };
    });
  }

  /** حساب بانکی مربوط به clearing — treasuryBankAccountId چک اگر ست باشد، وگرنه بانک اصلی (GL 1100) */
  private async clearingBankInTx(tx: Prisma.TransactionClient, treasuryBankAccountId: string | null) {
    if (treasuryBankAccountId) {
      const b = await tx.bankAccount.findUnique({ where: { id: treasuryBankAccountId } });
      if (b) return b;
    }
    const gl = await tx.account.findUnique({ where: { code: GL_BANK } });
    if (!gl) return null;
    return tx.bankAccount.findFirst({ where: { glAccountId: gl.id, active: true }, orderBy: { name: "asc" } });
  }

  /**
   * اثر حسابداری/خزانه‌ای/AR هر گذار — همیشه داخل تراکنش فراخوان.
   * قاعدهٔ STEP 2/5/6: revenue هرگز اینجا ساخته نمی‌شود (فروش قبلاً Cr 4000 شده)؛
   * اینجا فقط جابه‌جایی بین 1210/1220/1100/2100/2110 است — هیچ مسیر دوباره‌شناسی درآمد ندارد.
   */
  private async applyEffectsInTx(
    tx: Prisma.TransactionClient,
    check: {
      id: string; direction: string; status: string; amount: bigint; number: string; bankName: string;
      customerId: string | null; supplierId: string | null; treasuryBankAccountId: string | null;
    },
    input: TransitionInput,
  ): Promise<string | null> {
    const at = input.effectiveAt ?? new Date();
    const amount = Number(check.amount);
    const post = async (description: string, lines: Array<{ accountCode: string; debit?: number; credit?: number }>) => {
      const entry = await this.journal.postOrNotifyInTx(tx, {
        description,
        sourceType: "check_transition",
        sourceId: `${check.id}:${input.toStatus}`,
        actorId: input.actorId,
        date: at,
        lines,
      });
      return entry.id;
    };

    // ---------- RECEIVED ----------
    if (check.direction === "RECEIVED") {
      if (input.toStatus === "CLEARED") {
        const bank = await this.clearingBankInTx(tx, check.treasuryBankAccountId);
        const lines = [{ accountCode: GL_BANK, debit: amount }, { accountCode: GL_CHECK_RECEIVABLE, credit: amount }];
        if (bank) await tx.bankAccount.update({ where: { id: bank.id }, data: { currentBalance: { increment: BigInt(amount) } } });
        // تسویهٔ AR CHECK — موضع «چک» به پول نقد تبدیل شد؛ بدهی مشتری صفر می‌شود (بدون double-count)
        await this.settleArCheckInTx(tx, check.id, amount);
        const jeId = await post(`وصول چک دریافتی ${check.number} — ${check.bankName}${input.bankStatementId ? ` (صورتحساب ${input.bankStatementId})` : ""}`, lines);
        return jeId;
      }
      if (input.toStatus === "BOUNCED" || input.toStatus === "RETURNED") {
        if (check.status === "CLEARED") {
          // برگشت بعد از وصول: پول از بانک برمی‌گردد بیرون؛ مطالبه دوباره به‌صورت AR TRADE جدید
          const bank = await this.clearingBankInTx(tx, check.treasuryBankAccountId);
          if (bank) await tx.bankAccount.update({ where: { id: bank.id }, data: { currentBalance: { decrement: BigInt(amount) } } });
          await this.reinstateArTradeInTx(tx, check, "برگشت چک وصول‌شده");
          const jeId = await post(`برگشت چک وصول‌شده ${check.number} — مطالبه از مشتری (1210)`, [
            { accountCode: GL_AR_TRADE, debit: amount },
            { accountCode: GL_BANK, credit: amount },
          ]);
          return jeId;
        }
        // برگشت قبل از وصول: 1220 صفر → مطالبه تجاری (نوع ردیف AR از CHECK به TRADE تبدیل می‌شود — بدون double-count)
        await this.convertArCheckToTradeInTx(tx, check.id);
        const jeId = await post(`${input.toStatus === "BOUNCED" ? "برگشت" : "عودت"} چک ${check.number} (قبل از وصول) — مطالبه از مشتری (1210)`, [
          { accountCode: GL_AR_TRADE, debit: amount },
          { accountCode: GL_CHECK_RECEIVABLE, credit: amount },
        ]);
        return jeId;
      }
      // DEPOSITED — بدون اثر مالی
      return null;
    }

    // ---------- ISSUED ----------
    if (input.toStatus === "CLEARED") {
      // این لحظه واقعیِ خروج پول از بانک است — نه لحظه صدور
      const bank = await this.clearingBankInTx(tx, check.treasuryBankAccountId);
      if (bank) await tx.bankAccount.update({ where: { id: bank.id }, data: { currentBalance: { decrement: BigInt(amount) } } });
      const jeId = await post(`وصول چک صادره ${check.number} — ${check.bankName}`, [
        { accountCode: GL_OUTSTANDING_PAYABLE, debit: amount },
        { accountCode: GL_BANK, credit: amount },
      ]);
      return jeId;
    }
    if (input.toStatus === "BOUNCED" || input.toStatus === "CANCELLED") {
      // بدهی به تامین‌کننده برمی‌گردد:
      //  - قبل از وصول: 2110 صفر → 2100
      //  - بعد از وصول: پول برگشت‌خورده به بانک برمی‌گردد (chargeback) و بدهی دوباره در 2100
      if (check.status === "CLEARED") {
        const bank = await this.clearingBankInTx(tx, check.treasuryBankAccountId);
        if (bank) await tx.bankAccount.update({ where: { id: bank.id }, data: { currentBalance: { increment: BigInt(amount) } } });
        const jeId = await post(`برگشت چک صادره ${check.number} بعد از وصول — بازگشت بدهی تامین‌کننده`, [
          { accountCode: GL_BANK, debit: amount },
          { accountCode: GL_AP, credit: amount },
        ]);
        await this.reinstateSupplierDebtInTx(tx, check);
        return jeId;
      }
      const jeId = await post(`${input.toStatus === "BOUNCED" ? "برگشت" : "ابطال"} چک صادره ${check.number} (قبل از وصول) — بازگشت بدهی تامین‌کننده`, [
        { accountCode: GL_OUTSTANDING_PAYABLE, debit: amount },
        { accountCode: GL_AP, credit: amount },
      ]);
      await this.reinstateSupplierDebtInTx(tx, check);
      return jeId;
    }
    // PRESENTED — بدون اثر مالی
    return null;
  }

  // ---------------- AR / معین مشتری (STEP 7) ----------------

  /** وصول چک → ردیف AR CHECK تسویه و ماندهٔ معین مشتری کم می‌شود */
  private async settleArCheckInTx(tx: Prisma.TransactionClient, checkId: string, amount: number) {
    await tx.accountsReceivable.updateMany({
      where: { refType: "check", refId: checkId, exposureType: "CHECK", state: { in: ["OPEN", "PARTIAL"] } },
      data: { paidAmount: { increment: BigInt(amount) }, state: "SETTLED" },
    });
    const ar = await tx.accountsReceivable.findFirst({ where: { refType: "check", refId: checkId, exposureType: "CHECK" }, select: { accountPId: true } });
    if (ar) {
      await tx.customerAccount.updateMany({ where: { id: ar.accountPId }, data: { outstanding: { decrement: BigInt(amount) } } });
    }
  }

  /** برگشت قبل از وصول → همان ردیف AR به TRADE تبدیل می‌شود (بدهی باقی است — هیچ ردیف دومی) */
  private async convertArCheckToTradeInTx(tx: Prisma.TransactionClient, checkId: string) {
    await tx.accountsReceivable.updateMany({
      where: { refType: "check", refId: checkId, exposureType: "CHECK" },
      data: { exposureType: "TRADE" },
    });
  }

  /** برگشت بعد از وصول → بدهی جدید TRADE (ردیف CHECK قبلی SETTLED تاریخچه است) + معین مشتری بالا می‌رود */
  private async reinstateArTradeInTx(
    tx: Prisma.TransactionClient,
    check: { id: string; customerId: string | null; amount: bigint; number: string },
    reason: string,
  ) {
    if (!check.customerId) return;
    const ca = await tx.customerAccount.findUnique({ where: { customerId: check.customerId } });
    if (!ca) return; // معین مشتری از seed/مسیر قبل موجود است؛ بدون آن ردیف AR نمی‌سازیم (هیچ داده فیک)
    await tx.accountsReceivable.create({
      data: { accountPId: ca.id, refType: "check", refId: check.id, exposureType: "TRADE", amount: check.amount, state: "OPEN", dueDate: null },
    });
    await tx.customerAccount.update({ where: { id: ca.id }, data: { outstanding: { increment: check.amount } } });
    void reason;
  }

  // ---------------- معین تامین‌کننده / AP (STEP 4/6) ----------------

  /**
   * برگشت/ابطال چک صادره → بدهی تامین‌کننده برمی‌گردد: معین supplierAccount.outstanding++
   * و اگر چک به پرداخت فاکتور خرید وصل بوده، AP همان فاکتور paidAmount−/state بازسازی می‌شود.
   */
  private async reinstateSupplierDebtInTx(
    tx: Prisma.TransactionClient,
    check: { id: string; supplierId: string | null; amount: bigint; number: string },
  ) {
    if (check.supplierId) {
      await tx.supplierAccount.updateMany({ where: { supplierId: check.supplierId }, data: { outstanding: { increment: check.amount } } });
    }
    const pp = await tx.purchasePayment.findFirst({ where: { checkId: check.id }, select: { invoiceId: true, amount: true } });
    if (pp) {
      const ap = await tx.accountsPayable.findFirst({ where: { refType: "purchase_invoice", refId: pp.invoiceId } });
      if (ap) {
        const paidAmount = ap.paidAmount > pp.amount ? ap.paidAmount - pp.amount : 0n;
        await tx.accountsPayable.update({
          where: { id: ap.id },
          data: { paidAmount, state: paidAmount >= ap.amount ? "SETTLED" : paidAmount > 0n ? "PARTIAL" : "OPEN" },
        });
      }
    }
  }

  // ---------------- میان‌بُرهای عملیاتی ----------------

  /** وصول — فقط یک‌بار (idempotencyKey تکراری → replay؛ بعد از CLEARED → INVALID_TRANSITION) */
  async clear(input: { checkId: string; idempotencyKey: string; actorId?: string; effectiveAt?: Date; bankStatementId?: string; reason?: string }) {
    return this.transition({ ...input, toStatus: "CLEARED" });
  }

  /** برگشت چک — duplicate idempotent، همزمانی با CAS */
  async bounce(input: { checkId: string; idempotencyKey: string; actorId?: string; reason?: string }) {
    return this.transition({ ...input, toStatus: "BOUNCED" });
  }

  /** ابطال — فقط چک صادره (دریافتی مسیر مستقیم ندارد → INVALID_TRANSITION) */
  async cancel(input: { checkId: string; idempotencyKey: string; actorId?: string; reason?: string }) {
    return this.transition({ ...input, toStatus: "CANCELLED" });
  }
}
