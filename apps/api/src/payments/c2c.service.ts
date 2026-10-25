import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { InventoryService } from "../inventory/inventory.service";
import { PaymentsService } from "./payments.service";

/**
 * گام ۱۸-۱ — پرداخت کارت‌به‌کارت با سوییچ خاموش‌شدنی (تصمیم #۱۴).
 *
 * چرخه:
 *   مشتری در صفحهٔ پرداخت کارت فروشگاه را می‌بیند → واریز می‌کند →
 *   رسید (کد پیگیری/تاریخ/ساعت/بانک مبدأ) را ثبت می‌کند →
 *   PaymentAttempt (PENDING→REQUIRES_REVIEW) + CardToCardSubmission
 *   (PENDING_VERIFICATION) ساخته می‌شود → ادمین در صف تصمیم می‌گیرد
 *   (تأیید/رد/اصلاح) → تأیید = همان نهایی‌سازی پرداخت آنلاین
 *   (سفارش PAID + سند فروش + خزانه + مصرف رزرو + رویداد OrderPaid).
 *
 * سوییچ: `Setting("payment").cardToCardEnabled` — پیش‌فرض خاموش؛ فقط مقدار
 * صریحِ true روشن است. پس از اخذ درگاه، خاموش شود و گزینه از مشتری حذف گردد.
 *
 * SMS (بند ۱۱۱): فقط ردیف Notification صف می‌شود؛ ارسال واقعی با credential
 * اپراتور توسط dispatcher موجود انجام می‌شود — بدون credential ردیفی ساخته
 * نمی‌شود و هیچ «ارسال شد» جعلی وجود ندارد.
 */

const C2C_SETTING_KEY = "payment";
/** مهلت واریز کارت‌به‌کارت — بند ۲۳: پس از آن رسید پذیرفته نمی‌شود */
export const C2C_EXPIRY_HOURS = 48;

/** گذارهای مجاز وضعیت رسید — بند ۸: گذار دلخواه ممنوع */
const SUBMISSION_DECIDABLE = new Set(["PENDING_VERIFICATION", "UNDER_REVIEW", "CORRECTION_REQUIRED"]);

export type C2cDecisionAction = "APPROVE" | "REJECT" | "CORRECTION";

export interface C2cSubmitInput {
  orderCode: string;
  idempotencyKey: string;
  referenceNo?: string;
  transferDate?: string; // YYYY-MM-DD
  transferTime?: string; // HH:MM
  sourceBank?: string;
  note?: string;
}

/** ماسک شماره‌کارت برای نمایش عمومی — همهٔ رقم‌ها جز ۴ رقم آخر پنهان */
export function maskCardNumber(card: string): string {
  const digits = (card ?? "").replace(/\D/g, "");
  if (digits.length < 8) return "••••";
  return `•••• •••• •••• ${digits.slice(-4)}`;
}

/** فیلدهایی که حساب می‌تواند به مشتری نشان بدهد — بند ۱۴ (visibleFields) */
const ACCOUNT_PUBLIC_FIELDS = ["bankName", "holderName", "cardNumber", "iban"] as const;

export interface PublicAccountView {
  id: string;
  bankName: string;
  displayTitle: string | null;
  holderName: string | null;
  cardNumber: string | null;
  iban: string | null;
  customerInstructions: string | null;
}

@Injectable()
export class C2cService {
  private readonly logger = new Logger(C2cService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly inventory: InventoryService,
  ) {}

  // ── سوییچ خاموش‌شدنی ────────────────────────────────────────────────

  /** فقط مقدار صریحِ true روشن است — پیش‌فرض امن خاموش؛ خواندن دفاعی */
  async isEnabled(): Promise<boolean> {
    const row = await this.prisma.setting.findUnique({ where: { key: C2C_SETTING_KEY } }).catch(() => null);
    const value = (row?.value ?? {}) as { cardToCardEnabled?: unknown };
    return value?.cardToCardEnabled === true;
  }

  async setEnabled(enabled: boolean): Promise<boolean> {
    const row = await this.prisma.setting.findUnique({ where: { key: C2C_SETTING_KEY } });
    const value = { ...((row?.value ?? {}) as object), cardToCardEnabled: enabled === true };
    await this.prisma.setting.upsert({
      where: { key: C2C_SETTING_KEY },
      create: { key: C2C_SETTING_KEY, value: value as object },
      update: { value: value as object },
    });
    return enabled === true;
  }

  /**
 * نمای عمومی یک حساب — فقط فیلدهایی که ادمین مجاز اعلام کرده.
 * شمارهٔ کارت کامل می‌رود چون مشتری بدون آن اصلاً نمی‌تواند واریز کند؛
 * کنترل در «آیا اصلاً نمایش داده شود» است (visibleFields)، نه در ماسک‌کردن.
 */
  publicAccountView(a: {
    id: string;
    bankName: string;
    displayTitle: string | null;
    holderName: string;
    cardNumber: string;
    iban: string | null;
    customerInstructions: string | null;
    visibleFields: unknown;
  }): PublicAccountView {
    const allowed = new Set<string>(
      Array.isArray(a.visibleFields) && (a.visibleFields as unknown[]).every((f) => typeof f === "string")
        ? (a.visibleFields as string[])
        : ACCOUNT_PUBLIC_FIELDS,
    );
    return {
      id: a.id,
      bankName: allowed.has("bankName") ? a.bankName : "",
      displayTitle: a.displayTitle,
      holderName: allowed.has("holderName") ? a.holderName : null,
      cardNumber: allowed.has("cardNumber") ? a.cardNumber : null,
      iban: allowed.has("iban") ? a.iban : null,
      customerInstructions: a.customerInstructions,
    };
  }

  /** پیکربندی عمومی برای صفحهٔ پرداخت مشتری — خاموش = بدون کارت‌ها */
  async publicConfig(): Promise<{
    enabled: boolean;
    expiryHours: number;
    accounts: PublicAccountView[];
  }> {
    const enabled = await this.isEnabled();
    const accounts = enabled
      ? await this.prisma.cardToCardAccount.findMany({
          where: { active: true },
          orderBy: { sortOrder: "asc" },
        })
      : [];
    return {
      enabled,
      expiryHours: C2C_EXPIRY_HOURS,
      accounts: accounts.map((a) => this.publicAccountView(a)),
    };
  }

  // ── ثبت رسید از سمت مشتریی ───────────────────────────────────────────

  /** ثبت گذار روی attempt — همان الگوی PaymentsService (بند ۸: هر گذار لاگ) */
  private async recordTransition(id: string, state: string, actorId?: string, failReason?: string): Promise<void> {
    const attempt = await this.prisma.paymentAttempt.findUnique({ where: { id }, select: { transitions: true } });
    const list = Array.isArray(attempt?.transitions) ? (attempt!.transitions as unknown[]) : [];
    await this.prisma.paymentAttempt.update({
      where: { id },
      data: {
        state: state as never,
        failReason: failReason ?? undefined,
        transitions: [...list, { state, at: new Date().toISOString(), actorId: actorId ?? null }] as object,
      },
    });
  }

  /**
   * انقضای تنبل (بند ۲۳): هر جا وضعیت خوانده/نوشته شد، اول انقضای رسیده را
   * قطعی می‌کنیم — submission EXPIRED + attempt FAILED + آزادسازی رزرو.
   * بدون scheduler اضافه؛ همان خواندن‌ها فرصت اجرا هستند.
   */
  async expireIfNeeded(submission: { id: string; attemptId: string; state: string }): Promise<boolean> {
    const attempt = await this.prisma.paymentAttempt.findUnique({ where: { id: submission.attemptId } });
    if (!attempt || !attempt.expiresAt || attempt.expiresAt > new Date()) return false;
    if (["APPROVED", "REJECTED", "EXPIRED", "CANCELLED"].includes(submission.state)) return false;
    await this.prisma.cardToCardSubmission.update({
      where: { id: submission.id },
      data: { state: "EXPIRED" as const },
    });
    await this.recordTransition(attempt.id, "FAILED", undefined, "مهلت واریز کارت‌به‌کارت تمام شد (بند ۲۳)");
    await this.inventory.releaseByRef(attempt.orderId ?? "__none__");
    return true;
  }

  /** آخرین رسیدِ سفارش برای نمایش به مشتری (صفحهٔ پرداخت) */
  async latestForOrder(orderCode: string): Promise<{
    state: string;
    referenceNo: string | null;
    transferDate: string | null;
    transferTime: string | null;
    decisionNote: string | null;
    createdAt: string;
  } | null> {
    const order = await this.prisma.order.findUnique({ where: { code: orderCode }, select: { id: true } });
    if (!order) return null;
    const sub = await this.prisma.cardToCardSubmission.findFirst({
      where: { attempt: { orderId: order.id } },
      orderBy: { createdAt: "desc" },
    });
    if (!sub) return null;
    await this.expireIfNeeded(sub);
    const fresh = await this.prisma.cardToCardSubmission.findUnique({ where: { id: sub.id } });
    if (!fresh) return null;
    return {
      state: fresh.state,
      referenceNo: fresh.referenceNo,
      transferDate: fresh.transferDate,
      transferTime: fresh.transferTime,
      decisionNote: fresh.decisionNote,
      createdAt: fresh.createdAt.toISOString(),
    };
  }

  /**
   * ثبت/به‌روزرسانی رسید — به‌ادرخواست submit مشتری.
   *
   * اصلاح: اگر آخرین رسید همین attempt در CORRECTION_REQUIRED باشد، همان ردیف
   * به‌روز می‌شود (تاریخچه در transitions می‌ماند). رد شده = واریز دوباره →
   * attempt جدید. رسید در انتظار بررسی = خطای روشن، نه ردیف دوم.
   */
  async submit(input: C2cSubmitInput): Promise<{ submissionId: string; state: string }> {
    if (!(await this.isEnabled())) {
      throw new ForbiddenException({
        code: "C2C_DISABLED",
        message: "پرداخت کارت‌به‌کارت فعلاً فعال نیست.",
      });
    }
    const orderCode = input.orderCode?.trim();
    if (!orderCode || !input.idempotencyKey) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "کد سفارش و کلید تلاش لازم است." });
    }
    if (input.referenceNo != null && !/^[0-9\-\u06F0-\u06F9]{5,30}$/.test(input.referenceNo.trim())) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "کد پیگیری باید ۵ تا ۳۰ رقم باشد.",
      });
    }
    if (input.transferDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(input.transferDate)) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "تاریخ واریز باید به شکل YYYY-MM-DD باشد." });
    }
    if (input.transferTime != null && !/^\d{2}:\d{2}$/.test(input.transferTime)) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "ساعت واریز باید به شکل HH:MM باشد." });
    }

    // idempotency (بند ۱۰): تلاش دوباره با همان کلید → همان رسید، بدون ردیف جدید
    const idem = await this.prisma.paymentAttempt.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { submissions: true },
    });
    if (idem?.submissions.length) {
      await this.expireIfNeeded(idem.submissions[0]);
      const sub = await this.prisma.cardToCardSubmission.findUnique({ where: { id: idem.submissions[0].id } });
      if (sub && !["EXPIRED", "CANCELLED"].includes(sub.state)) {
        return { submissionId: sub.id, state: sub.state };
      }
    }

    const order = await this.prisma.order.findUnique({ where: { code: orderCode } });
    if (!order) throw new NotFoundException({ code: "NOT_FOUND", message: "سفارش یافت نشد." });
    if (order.paymentStatus === "PAID") {
      throw new BadRequestException({ code: "ORDER_PAID", message: "این سفارش قبلاً پرداخت شده است." });
    }
    // بند ۲۳: مهلت واریز ۴۸ ساعت از ثبت سفارش — پس از آن رسید پذیرفته نیست
    if (order.createdAt.getTime() + C2C_EXPIRY_HOURS * 3600_000 < Date.now()) {
      throw new BadRequestException({
        code: "C2C_EXPIRED",
        message: "مهلت پرداخت کارت‌به‌کارت این سفارش گذشته است؛ لطفاً سفارش جدید ثبت کن یا با پشتیبانی تماس بگیر.",
      });
    }

    const method = await this.prisma.paymentMethod.findFirst({ where: { code: "card_to_card" } });
    if (!method || !method.active) {
      throw new BadRequestException({ code: "NO_C2C_METHOD", message: "روش پرداخت کارت‌به‌کارت فعال نیست." });
    }
    const accounts = await this.prisma.cardToCardAccount.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
    if (accounts.length === 0) {
      throw new BadRequestException({
        code: "NO_C2C_ACCOUNT",
        message: "هیچ کارتی برای واریز تعریف نشده است؛ از پشتیبانی بخواه کارت فروشگاه را بفرستد.",
      });
    }

    // رسید در انتظار بررسی از قبل هست؟ (بدون attempt جدید — بند ۲۲)
    const pending = await this.prisma.cardToCardSubmission.findFirst({
      where: {
        attempt: { orderId: order.id },
        state: { in: ["PENDING_VERIFICATION", "UNDER_REVIEW"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (pending) {
      await this.expireIfNeeded(pending);
      const still = await this.prisma.cardToCardSubmission.findUnique({ where: { id: pending.id } });
      if (still && still.state === pending.state) {
        throw new ConflictException({
          code: "SUBMISSION_IN_REVIEW",
          message: "رسید قبلی تو هنوز در انتظار بررسی است؛ نتیجه را همین‌جا می‌بینی.",
        });
      }
    }

    // اصلاح: رسید در حالت CORRECTION_REQUIRED همین attempt → همان ردیف به‌روز می‌شود
    const correctable = await this.prisma.cardToCardSubmission.findFirst({
      where: { attempt: { orderId: order.id }, state: "CORRECTION_REQUIRED" },
      orderBy: { createdAt: "desc" },
    });

    const destAccount = accounts[0];
    const refNo = input.referenceNo?.trim() || null;
    const expiresAt = new Date(Date.now() + C2C_EXPIRY_HOURS * 3600_000);

    // attempt فقط برای ثبت اولیه/اصلاح ساخته می‌شود؛ رد شده → واریز دوباره مشتری
    let attemptId: string;
    if (correctable) {
      attemptId = correctable.attemptId;
    } else if (idem) {
      attemptId = idem.id; // تلاش idempotent که رسیدش منقضی شده — دوباره استفاده می‌شود
    } else {
      const attempt = await this.prisma.paymentAttempt.create({
        data: {
          orderId: order.id,
          methodId: method.id,
          channelId: order.channelId,
          amount: order.total,
          state: "PENDING",
          idempotencyKey: input.idempotencyKey,
          expiresAt,
        },
      });
      attemptId = attempt.id;
    }

    const data = {
      attemptId,
      destAccountId: destAccount.id,
      amount: order.total,
      transferDate: input.transferDate ?? null,
      transferTime: input.transferTime ?? null,
      sourceBank: input.sourceBank?.trim() || null,
      referenceNo: refNo,
      note: input.note?.trim() || null,
      state: "PENDING_VERIFICATION" as const,
      decidedById: null,
      decidedAt: null,
      decisionNote: null,
    };

    let submission;
    try {
      submission = correctable
        ? await this.prisma.cardToCardSubmission.update({ where: { id: correctable.id }, data })
        : await this.prisma.cardToCardSubmission.create({ data });
    } catch (e) {
      // کد پیگیری تکراری برای همان حساب و مبلغ — بند ۲۲ (قید یکتای دیتابیس)
      if ((e as { code?: string })?.code === "P2002") {
        throw new ConflictException({
          code: "DUPLICATE_REFERENCE",
          message: "این کد پیگیری قبلاً برای همین کارت ثبت شده؛ اگر جاش اشتباه بود با پشتیبانی تماس بگیر.",
        });
      }
      throw e;
    }

    // attempt می‌رود به صف بررسی ادمین (بند ۴۸): PENDING → REQUIRES_REVIEW
    await this.recordTransition(attemptId, "REQUIRES_REVIEW", undefined, "رسید کارت‌به‌کارت ثبت شد");

    // اطلاع ادمین — فقط ردیف Notification؛ ارسال واقعی با dispatcher موجود
    await this.notifyAdmin(`c2c-submitted:${submission.id}`, "رسید کارت‌به‌کارت جدید ثبت شد", {
      submissionId: submission.id,
      orderCode,
      referenceNo: refNo,
    });

    this.logger.log(`C2C submission=${submission.id} order=${orderCode} ref=${refNo ?? "-"}`);
    return { submissionId: submission.id, state: submission.state };
  }

  // ── صف ادمین ───────────────────────────────────────────────────────

  async adminList(q: { state?: string; page?: string }): Promise<{
    items: Array<Record<string, unknown>>;
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = 20;
    const where = q.state ? { state: q.state as never } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.cardToCardSubmission.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          destAccount: { select: { bankName: true, cardNumber: true } },
          decidedBy: { select: { name: true } },
          attempt: {
            select: {
              id: true,
              expiresAt: true,
              order: { select: { code: true, guestMobile: true, guestName: true, user: { select: { name: true, mobile: true } } } },
            },
          },
        },
      }),
      this.prisma.cardToCardSubmission.count({ where }),
    ]);

    for (const s of rows) {
      // انقضای تنبل: رسیدِ موعد‌رسیده را همان‌جا قطعی می‌کنیم تا ادمین تصویر تازه ببیند
      await this.expireIfNeeded(s);
    }
    const fresh = await this.prisma.cardToCardSubmission.findMany({
      where: { id: { in: rows.map((s) => s.id) } },
    });
    const stateById = new Map(fresh.map((s) => [s.id, s.state]));

    return {
      items: rows.map((s) => ({
        id: s.id,
        state: stateById.get(s.id) ?? s.state,
        amount: String(s.amount),
        referenceNo: s.referenceNo,
        transferDate: s.transferDate,
        transferTime: s.transferTime,
        sourceBank: s.sourceBank,
        note: s.note,
        decisionNote: s.decisionNote,
        createdAt: s.createdAt,
        expiresAt: s.attempt.expiresAt,
        decidedBy: s.decidedBy?.name ?? null,
        destAccount: {
          bankName: s.destAccount.bankName,
          cardMasked: maskCardNumber(s.destAccount.cardNumber),
        },
        order: s.attempt.order
          ? {
              code: s.attempt.order.code,
              customerName: s.attempt.order.user?.name ?? s.attempt.order.guestName ?? null,
              mobile: s.attempt.order.user?.mobile ?? s.attempt.order.guestMobile ?? null,
            }
          : null,
      })),
      total,
      page,
      limit,
    };
  }

  /**
   * تصمیم ادمین — تأیید/رد/اصلاح (بند ۴۸).
   *
   * تأیید = همان زنجیرهٔ نهایی‌سازی آنلاین: سفارش PAID + سند فروش + خزانه +
   * مصرف رزرو + رویداد OrderPaid. رد = attempt FAILED + آزادسازی رزرو (بند ۲۳).
   * اصلاح = رسید به CORRECTION_REQUIRED می‌رود تا مشتری همان را ویرایش کند.
   */
  async decide(input: {
    submissionId: string;
    action: C2cDecisionAction;
    adminId: string;
    note?: string;
  }): Promise<{ state: string }> {
    const submission = await this.prisma.cardToCardSubmission.findUnique({
      where: { id: input.submissionId },
      include: { attempt: { include: { order: { select: { code: true, guestMobile: true, user: { select: { mobile: true } } } } } } },
    });
    if (!submission) throw new NotFoundException({ code: "NOT_FOUND", message: "رسید یافت نشد." });

    await this.expireIfNeeded(submission);
    const fresh = await this.prisma.cardToCardSubmission.findUnique({ where: { id: submission.id } });
    if (!fresh || !SUBMISSION_DECIDABLE.has(fresh.state)) {
      throw new BadRequestException({
        code: "SUBMISSION_NOT_DECIDABLE",
        message: "این رسید قبلاً نهایی شده یا منقضی است.",
      });
    }

    const attempt = submission.attempt;
    const note = input.note?.trim() || null;
    const target = input.action === "APPROVE" ? "APPROVED" : input.action === "REJECT" ? "REJECTED" : "CORRECTION_REQUIRED";

    if (input.action === "APPROVE") {
      // سفارش پرداخت‌شده = بدون تصمیم دوباره؛ idempotent (بند ۱۰/۱۱۶)
      if (attempt.order && attempt.orderId) {
        const ord = await this.prisma.order.findUnique({ where: { id: attempt.orderId }, select: { paymentStatus: true } });
        if (ord?.paymentStatus === "PAID") {
          await this.prisma.cardToCardSubmission.update({
            where: { id: fresh.id },
            data: { state: "APPROVED", decidedById: input.adminId, decidedAt: new Date(), decisionNote: note },
          });
          return { state: "APPROVED" };
        }
      }
      // شناسهٔ تراکنش یکتا و قابل ردیابی؛ کد پیگیری مشتری در submission می‌ماند
      await this.payments.finalizeVerifiedAttempt(attempt.id, `c2c:${fresh.id}`, input.adminId);
    } else if (input.action === "REJECT") {
      await this.recordTransition(attempt.id, "FAILED", input.adminId, note ?? "رسید کارت‌به‌کارت رد شد");
      await this.inventory.releaseByRef(attempt.orderId ?? "__none__");
    }

    const updated = await this.prisma.cardToCardSubmission.update({
      where: { id: fresh.id },
      data: {
        state: target as never,
        decidedById: input.adminId,
        decidedAt: new Date(),
        decisionNote: note,
      },
    });

    // SMS به مشتری — فقط صف؛ ارسال واقعی با credential (بند ۱۱۱)
    const mobile = attempt.order?.user?.mobile ?? attempt.order?.guestMobile ?? null;
    const orderCode = attempt.order?.code ?? "";
    if (mobile && orderCode) {
      const fa = input.action === "APPROVE" ? "تایید" : input.action === "REJECT" ? "رد" : "نیاز به اصلاح";
      await this.queueSms(mobile, `c2c-decision:${fresh.id}`, {
        orderCode,
        action: fa,
        note: note ?? "",
      });
    }

    this.logger.log(`C2C decide=${input.action} submission=${fresh.id} order=${orderCode} by=${input.adminId}`);
    return { state: updated.state };
  }

  // ── صف اطلاع‌رسانی ────────────────────────────────────────────────────

  private async notifyAdmin(key: string, title: string, payload: Record<string, unknown>): Promise<void> {
    const dup = await this.prisma.notification.findFirst({
      where: { channel: "ADMIN", templateKey: key },
    });
    if (dup) return;
    await this.prisma.notification.create({
      data: { channel: "ADMIN", templateKey: key, to: "admin-dashboard", payload: { title, ...payload } },
    });
  }

  private async queueSms(mobile: string, key: string, payload: Record<string, unknown>): Promise<void> {
    // بدون credential اپراتور هیچ ردیفی ساخته نمی‌شود — «ارسال شد» جعلی ممنوع (بند ۱۱۱)
    if (!process.env.KAVENEGAR_API_KEY) return;
    const dup = await this.prisma.notification.findFirst({ where: { channel: "SMS", templateKey: key } });
    if (dup) return;
    await this.prisma.notification.create({
      data: { channel: "SMS", templateKey: key, to: mobile, payload: { ...payload, template: "c2c-decision" } },
    });
  }
}
