import { BadRequestException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { FiscalYearService } from "./fiscal-year.service";
import { money, type Money } from "@ghasedak/contracts";

export interface JournalLineInput {
  accountCode: string;
  debit?: number;
  credit?: number;
  partyType?: string;
  partyId?: string;
  /** انبار این خط (فاز ۶) — برای گزارش سود هر انبار */
  warehouseId?: string;
}

export interface PostEntryInput {
  date?: Date;
  description?: string;
  sourceType?: string;
  sourceId?: string;
  actorId?: string;
  /** انباری که کل سند به آن مربوط است؛ روی خطوط موجودی اعمال می‌شود */
  warehouseId?: string;
  lines: JournalLineInput[];
}

/**
 * موتور سند حسابداری — بند ۲۴/۲۵: Double-entry واقعی با قید سخت Dr=Cr.
 * همه تراکنش‌ها از این سرویس عبور می‌کنند؛ UI هرگز مستقیم سند نمی‌سازد (بند ۲۵).
 */
@Injectable()
export class JournalService {
  /**
   * سرویس سال مالی عمداً تزریق نمی‌شود.
   *
   * فقط به `prisma` نیاز دارد و ساختنش ارزان است؛ تزریقش باعث می‌شد
   * ۱۵ فایل تست که `new JournalService(prisma)` صدا می‌زنند بشکنند.
   * یک منبع حقیقت بودن مهم‌تر از تزریق شیک است.
   */
  private readonly fiscal: FiscalYearService;

  constructor(private readonly prisma: PrismaService) {
    this.fiscal = new FiscalYearService(prisma);
  }

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
    const prepared = this.prepareLines(input.lines, input.warehouseId);
    return this.createEntryInTx(tx, input, prepared);
  }

  /**
   * آماده‌سازی و اعتبارسنجی ردیف‌ها — مشترک بین post و postInTx
   *
   * `defaultWarehouseId` روی خطوطی می‌نشیند که خودشان انبار ندارند؛ پس یک سند
   * انبار فقط کافی است `warehouseId` را در سطح سند بدهد و همهٔ خطوط آن انبار
   * به‌نظر برسد.
   */
  private prepareLines(lines: JournalLineInput[], defaultWarehouseId?: string): Array<{ accountCode: string; debit: Money; credit: Money; partyType?: string; partyId?: string; warehouseId?: string }> {
    if (!lines || lines.length < 2) {
      throw new BadRequestException({ code: "JOURNAL_INVALID", message: "سند حداقل دو ردیف لازم دارد." });
    }
    let debitTotal = 0;
    let creditTotal = 0;
    const prepared: Array<{ accountCode: string; debit: Money; credit: Money; partyType?: string; partyId?: string; warehouseId?: string }> = [];
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
        warehouseId: line.warehouseId ?? defaultWarehouseId,
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
    prepared: Array<{ accountCode: string; debit: Money; credit: Money; partyType?: string; partyId?: string; warehouseId?: string }>,
  ): Promise<{ id: string; number: string }> {
    // سال از سرویس مرکزی می‌آید — مرتب‌شده و قطعی. قبلاً اینجا
    // `findFirst({ where: { state: "OPEN" } })` بدون ترتیب بود و وقتی
    // چند سال باز وجود داشت، سندها بین آن‌ها پخش می‌شدند.
    const year = await this.fiscal.requireYear(input.date, tx);

    if (input.date && (input.date < year.startsAt || input.date > year.endsAt)) {
      throw new BadRequestException({
        code: "FISCAL_PERIOD_INVALID",
        message: "تاریخ سند در بازهٔ سال مالی نیست.",
      });
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
                warehouseId: l.warehouseId ?? null,
              };
            }),
          ),
        },
      },
    });
    return { id: entry.id, number: entry.number };
  }

  async post(input: PostEntryInput): Promise<{ id: string; number: string }> {
    const prepared = this.prepareLines(input.lines, input.warehouseId);
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
      const year = await this.fiscal.requireYear(input.date ?? new Date(), tx);
      const inputDate = input.date ?? new Date();
      if (inputDate < year.startsAt || inputDate > year.endsAt) {
        throw new BadRequestException({ code: "FISCAL_PERIOD_INVALID", message: "تاریخ سند در بازهٔ سال مالی نیست." });
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
              warehouseId: l.warehouseId ?? null,
            })),
          },
        },
        select: { id: true, number: true, state: true },
      });
    });
    return entry;
  }

  /* ============================================================
   * اصلاح سندها (درخواست کاربر: سندهای خودکار اشتباه می‌خورند)
   *
   * قانون حسابداری رعایت شده:
   *  • سند FINAL مستقیم ویرایش نمی‌شود — اگر ویرایش می‌شد، تاریخچهٔ
   *    دفاتر بازنویسی می‌شد و معلوم نمی‌شد چه چیزی اشتباه بود.
   *  • به‌جایش «برگشت به پیش‌نویس» هست: سند از FINAL خارج می‌شود (و چون
   *    گزارش‌ها فقط FINAL را می‌خوانند، فوراً از تراز و دفترها پاک می‌شود)،
   *    بعد قابل ویرایش، و در پایان با یک کلیک دوباره FINAL می‌شود.
   *  • هر تغییر در AuditLog با قبل/بعد ثبت می‌شود.
   *  ============================================================ */

  /**
   * پیوست سند حسابداری (فاز ۴).
   *
   * مدل `Attachment` از قبل عمومی بود (`ownerType: journal`) ولی هیچ endpointی
   * نداشت، یعنی رسید کارت‌خوان یا فاکتور کاغذی را نمی‌شد به سند چسباند.
   *
   * فایل از کتابخانهٔ رسانه انتخاب می‌شود نه آپلود مستقیم، چون همان مسیری است
   * که magic-bytes و سقف حجم را بررسی می‌کند.
   */
  async addAttachment(entryId: string, mediaId: string, title?: string, actorId?: string) {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { id: entryId },
      select: { id: true, number: true, state: true },
    });
    if (!entry) throw new BadRequestException({ code: "NOT_FOUND", message: "سند یافت نشد." });

    const media = await this.prisma.media.findUnique({
      where: { id: mediaId },
      select: { id: true, storageKey: true, mime: true, alt: true, title: true },
    });
    if (!media) throw new BadRequestException({ code: "MEDIA_NOT_FOUND", message: "فایل در کتابخانهٔ رسانه یافت نشد." });

    const dup = await this.prisma.attachment.findFirst({ where: { ownerType: "journal", ownerId: entryId, mediaId } });
    if (dup) throw new BadRequestException({ code: "DUPLICATE_ATTACHMENT", message: "این فایل قبلاً به این سند پیوست شده است." });

    const att = await this.prisma.attachment.create({
      data: { mediaId, ownerType: "journal", ownerId: entryId, title: title?.trim() || null },
      include: { media: { select: { id: true, storageKey: true, mime: true, alt: true, title: true } } },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: actorId ?? "system",
        action: "accounting.journal.attach",
        entity: "JournalEntry",
        entityId: entryId,
        newValues: { attachmentId: att.id, mediaId, entryNumber: entry.number, entryState: entry.state } as object,
      },
    });

    return this.mapAttachment(att);
  }

  async listAttachments(entryId: string) {
    const rows = await this.prisma.attachment.findMany({
      where: { ownerType: "journal", ownerId: entryId },
      orderBy: { createdAt: "desc" },
      include: { media: { select: { id: true, storageKey: true, mime: true, alt: true, title: true } } },
    });
    return rows.map((a) => this.mapAttachment(a));
  }

  /**
   * حذف پیوست.
   *
   * فقط سند **پیش‌نویس** اجازه دارد: سند قطعی سندی است که دفتر قانونی به آن
   * ارجاع می‌دهد و پاک‌کردن مدرکش یعنی حذف سند از حسابرسی.
   */
  async removeAttachment(attachmentId: string, actorId?: string) {
    const att = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      select: { id: true, ownerId: true, mediaId: true },
    });
    if (!att) throw new BadRequestException({ code: "NOT_FOUND", message: "پیوست یافت نشد." });

    const entry = await this.prisma.journalEntry.findUnique({
      where: { id: att.ownerId },
      select: { state: true },
    });
    if (entry?.state === "FINAL") {
      throw new BadRequestException({
        code: "ENTRY_FINAL",
        message: "پیوست سند قطعی قابل حذف نیست. اول سند را به پیش‌نویس برگردانید.",
      });
    }

    await this.prisma.attachment.delete({ where: { id: attachmentId } });
    await this.prisma.auditLog.create({
      data: {
        actorId: actorId ?? "system",
        action: "accounting.journal.detach",
        entity: "JournalEntry",
        entityId: att.ownerId,
        oldValues: { attachmentId, mediaId: att.mediaId } as object,
      },
    });
    return { ok: true };
  }

  /** شکل یکنواخت پیوست برای UI */
  private mapAttachment(a: {
    id: string;
    title: string | null;
    createdAt: Date;
    media: { id: string; storageKey: string; mime: string; alt: string | null; title: string | null };
  }) {
    return {
      id: a.id,
      mediaId: a.media.id,
      title: a.title,
      alt: a.media.alt,
      mime: a.media.mime,
      createdAt: a.createdAt.toISOString(),
      // لینک سروی عمومی رسانه — همان مسیری که `/api/media/:key` سرو می‌کند
      url: `/api/media/${encodeURIComponent(a.media.storageKey)}`,
    };
  }

  /** فهرست اسناد — برای مرور و پیدا کردن سند اشتباه */
  async listEntries(query: { state?: "DRAFT" | "FINAL"; sourceType?: string; q?: string; page?: number; limit?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    const where = {
      ...(query.state ? { state: query.state } : {}),
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
      ...(query.q ? { OR: [{ number: { contains: query.q } }, { description: { contains: query.q } }] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.journalEntry.findMany({
        where,
        orderBy: { date: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { lines: { include: { account: { select: { code: true, name: true } } } } },
      }),
      this.prisma.journalEntry.count({ where }),
    ]);
    return {
      items: items.map((e) => ({
        id: e.id,
        number: e.number,
        date: e.date,
        description: e.description,
        sourceType: e.sourceType,
        sourceId: e.sourceId,
        state: e.state,
        totalDebit: e.lines.reduce((s, l) => s + Number(l.debit), 0),
        lines: e.lines.map((l) => ({
          accountCode: l.account.code,
          accountName: l.account.name,
          debit: Number(l.debit),
          credit: Number(l.credit),
        })),
      })),
      total,
      page,
      limit,
    };
  }

  /** یک سند با خطوطش */
  async getEntry(id: string) {
    const e = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: { lines: { include: { account: { select: { code: true, name: true } } } } },
    });
    if (!e) throw new BadRequestException({ code: "NOT_FOUND", message: "سند یافت نشد." });
    return {
      id: e.id,
      number: e.number,
      date: e.date,
      description: e.description,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      state: e.state,
      lines: e.lines.map((l) => ({
        id: l.id,
        accountCode: l.account.code,
        accountName: l.account.name,
        debit: Number(l.debit),
        credit: Number(l.credit),
      })),
    };
  }

  /**
   * ویرایش سند — فقط DRAFT.
   * اعتبارسنجی کامل دوباره اجرا می‌شود (حداقل دو ردیف، Dr/Cr مثبت، توازن،
   * حساب فعال) پس سند خراب ذخیره نمی‌شود.
   */
  async updateEntry(
    id: string,
    input: { description?: string; date?: string; lines?: PostEntryInput["lines"] },
    actorId?: string,
  ): Promise<{ id: string; number: string; state: string }> {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: { lines: { include: { account: { select: { code: true, name: true } } } } },
    });
    if (!entry) throw new BadRequestException({ code: "NOT_FOUND", message: "سند یافت نشد." });
    if (entry.state !== "DRAFT") {
      throw new BadRequestException({
        code: "ENTRY_FINAL",
        message: "سند قطعی مستقیم قابل ویرایش نیست. اول آن را به پیش‌نویس برگردانید.",
      });
    }

    const before = {
      description: entry.description,
      date: entry.date,
      lines: entry.lines.map((l) => ({ accountCode: l.account.code, debit: Number(l.debit), credit: Number(l.credit) })),
    };

    // اگر خطوط جدید داده شده، اعتبارسنجی می‌شود؛ وگرنه خطوط قبلی می‌مانند
    // `Money` یک شیء {amount, currency} است، نه عدد — پس `.amount` لازم است.
// (Number(moneyObj) می‌شد NaN و سند خطای ۵۰۰ می‌داد.)
let prepared: ReturnType<JournalService["prepareLines"]> = entry.lines.map((l) => ({
      accountCode: l.account.code,
      debit: money(Number(l.debit)),
      credit: money(Number(l.credit)),
    }));
    if (input.lines) prepared = this.prepareLines(input.lines);

    return this.prisma.$transaction(async (tx) => {
      if (input.lines) {
        await tx.journalLine.deleteMany({ where: { entryId: id } });
        for (const l of prepared) {
          const account = await tx.account.findUnique({ where: { code: l.accountCode } });
          if (!account) {
            throw new BadRequestException({ code: "ACCOUNT_NOT_FOUND", message: `حساب ${l.accountCode} یافت نشد.` });
          }
          if (!account.isActive) {
            throw new BadRequestException({ code: "ACCOUNT_INACTIVE", message: `حساب ${l.accountCode} غیرفعال است.` });
          }
          await tx.journalLine.create({
            data: {
              entryId: id,
              accountId: account.id,
              debit: BigInt(l.debit.amount),
              credit: BigInt(l.credit.amount),
            },
          });
        }
      }
      const updated = await tx.journalEntry.update({
        where: { id },
        data: {
          ...(input.description !== undefined ? { description: input.description.trim() || entry.description } : {}),
          ...(input.date ? { date: new Date(input.date) } : {}),
        },
        select: { id: true, number: true, state: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: actorId ?? null,
          action: "accounting.journal.update",
          entity: "JournalEntry",
          entityId: id,
          oldValues: before as never,
          newValues: { description: input.description ?? entry.description, lines: prepared } as never,
        },
      });
      return updated;
    });
  }

  /** حذف سند — فقط DRAFT */
  async deleteEntry(id: string, actorId?: string): Promise<{ ok: true }> {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: { lines: { include: { account: { select: { code: true } } } } },
    });
    if (!entry) throw new BadRequestException({ code: "NOT_FOUND", message: "سند یافت نشد." });
    if (entry.state !== "DRAFT") {
      throw new BadRequestException({
        code: "ENTRY_FINAL",
        message: "سند قطعی قابل حذف نیست. برای اصلاح، آن را به پیش‌نویس برگردانید.",
      });
    }
    const lines = entry.lines.map((l) => ({ accountCode: l.account.code, debit: Number(l.debit), credit: Number(l.credit) }));
    await this.prisma.$transaction(async (tx) => {
      await tx.journalEntry.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          actorId: actorId ?? null,
          action: "accounting.journal.delete",
          entity: "JournalEntry",
          entityId: id,
          oldValues: { number: entry.number, description: entry.description, lines } as never,
        },
      });
    });
    return { ok: true };
  }

  /**
   * برگشت سند قطعی به پیش‌نویس — همان چیزی که «اصلاح سند اشتباه» را ممکن می‌کند.
   * چون گزارش‌ها فقط FINAL را می‌خوانند، با این کار سند فوراً از تراز بیرون می‌رود.
   */
  async revertToDraft(id: string, actorId?: string): Promise<{ id: string; number: string; state: string }> {
    const entry = await this.prisma.journalEntry.findUnique({ where: { id } });
    if (!entry) throw new BadRequestException({ code: "NOT_FOUND", message: "سند یافت نشد." });
    if (entry.state !== "FINAL") {
      throw new BadRequestException({ code: "NOT_FINAL", message: "سند در وضعیت پیش‌نویس است." });
    }
    const updated = await this.prisma.journalEntry.update({
      where: { id },
      data: { state: "DRAFT" },
      select: { id: true, number: true, state: true },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: actorId ?? null,
        action: "accounting.journal.revert",
        entity: "JournalEntry",
        entityId: id,
        oldValues: { state: "FINAL", number: entry.number } as never,
        newValues: { state: "DRAFT" } as never,
      },
    });
    return updated;
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

  /** تراز آزمایشی — از منبع حقیقت Ledger (بند ۱۰۶/۱۰۷)
   *
   *  فقط سندهای FINAL.
   *
   *  این شرط قبلاً نبود و یک اشکال واقعی بود: سند DRAFT هم در تراز می‌آمد،
   *  در حالی که خودِ طراحی می‌گوید «سند پیش‌نویس اثر مالی ندارد». نتیجه دو
   *  چیز خراب می‌کرد: (۱) دفترهای در دست بازبینی ارقام نهایی را جابه‌جا
   *  می‌کردند، (۲) «برگشت سند به پیش‌نویس» هیچ اثری در تراز نمی‌گذاشت،
   *  پس اصلاح سند اشتباه عملاً غیرممکن بود.
   */
  async trialBalance(
    from?: Date,
    to?: Date,
  ): Promise<{
    from: string | null;
    to: string | null;
    items: Array<{ code: string; name: string; type: string; debit: string; credit: string }>;
    totals: { debit: string; credit: string };
    balanced: boolean;
  }> {
    const dateFilter = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
    const rows = await this.prisma.journalLine.groupBy({
      by: ["accountId"],
      where: { entry: { state: "FINAL", ...(from || to ? { date: dateFilter } : {}) } },
      _sum: { debit: true, credit: true },
    });
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: rows.map((r) => r.accountId) } },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const items = rows
      .map((r) => {
        const a = byId.get(r.accountId)!;
        return {
          code: a.code,
          name: a.name,
          type: a.type as string,
          debit: (r._sum.debit ?? 0n).toString(),
          credit: (r._sum.credit ?? 0n).toString(),
        };
      })
      .sort((x, y) => x.code.localeCompare(y.code));

    // جمع‌ها از همان ردیف‌ها محاسبه می‌شوند (نه کوئری دوم و نه جمع سمت UI) —
    // «بدون محاسبهٔ موازی» (بند ۱۰۶) در سطح همین گزارش هم رعایت می‌شود.
    const totals = items.reduce(
      (acc, r) => ({ debit: acc.debit + BigInt(r.debit), credit: acc.credit + BigInt(r.credit) }),
      { debit: 0n, credit: 0n },
    );

    return {
      from: from ? from.toISOString() : null,
      to: to ? to.toISOString() : null,
      items,
      totals: { debit: totals.debit.toString(), credit: totals.credit.toString() },
      balanced: totals.debit === totals.credit,
    };
  }

  /** کنترل سازگاری مالی — بند ۶۶: ΣDr = ΣCr روی کل Ledger */
  async integrity(): Promise<{ balanced: boolean; debit: string; credit: string }> {
    const agg = await this.prisma.journalLine.aggregate({
      where: { entry: { state: "FINAL" } },
      _sum: { debit: true, credit: true },
    });
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
      this.prisma.journalLine.groupBy({
        by: ["accountId"],
        where: { entry: { state: "FINAL" } },
        _sum: { debit: true, credit: true },
      }),
      this.prisma.journalLine.groupBy({
        by: ["accountId"],
        // فقط FINAL، مثل trialBalance — وگرنه سند پیش‌نویس دفتر را جابه‌جا می‌کرد
        where: { entry: { state: "FINAL" }, account: { level: { gte: 1 } } },
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
