import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { JournalService, type PostEntryInput } from "./journal.service";
import { PrismaService } from "../prisma/prisma.service";
import { RequirePermission } from "../auth/permissions.guard";
import { Identity } from "../auth/identity.decorator";

@Controller("admin/accounting")
export class AccountingController {
  constructor(
    private readonly journal: JournalService,
    private readonly prisma: PrismaService,
  ) {}

  @Post("journal")
  @RequirePermission("accounting.journal")
  post(@Body() body: PostEntryInput) {
    return this.journal.post(body);
  }

  /** فاز ۱۰ — بخش ۱۳: سند دستی DRAFT/FINAL (validation کامل در سرویس) */
  @Post("journal/manual")
  @RequirePermission("accounting.journal")
  postManual(
    @Body() body: PostEntryInput & { state?: "DRAFT" | "FINAL" },
    @Identity() actor?: { userId: string },
  ) {
    return this.journal.postManual({ ...body, actorId: actor?.userId });
  }

  /** فهرست اسناد — مرور اسناد و پیدا کردن سند اشتباه */
  @Get("journal")
  @RequirePermission("accounting.view")
  listJournal(
    @Query() q: { state?: "DRAFT" | "FINAL"; sourceType?: string; q?: string; page?: string; limit?: string },
  ) {
    return this.journal.listEntries({
      state: q.state === "DRAFT" || q.state === "FINAL" ? q.state : undefined,
      sourceType: q.sourceType || undefined,
      q: q.q || undefined,
      page: q.page ? Number(q.page) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
  }

  @Get("journal/:id")
  @RequirePermission("accounting.view")
  getJournal(@Param("id") id: string) {
    return this.journal.getEntry(id);
  }

  /** اصلاح سند — فقط پیش‌نویس. برای سند قطعی اول باید revert شود. */
  @Put("journal/:id")
  @RequirePermission("accounting.journal")
  updateJournal(
    @Param("id") id: string,
    @Body() body: { description?: string; date?: string; lines?: PostEntryInput["lines"] },
    @Identity() actor?: { userId: string },
  ) {
    return this.journal.updateEntry(id, body, actor?.userId);
  }

  @Delete("journal/:id")
  @RequirePermission("accounting.journal")
  deleteJournal(@Param("id") id: string, @Identity() actor?: { userId: string }) {
    return this.journal.deleteEntry(id, actor?.userId);
  }

  /** برگشت سند قطعی به پیش‌نویس — راه درستِ اصلاح سند اشتباه */
  @Post("journal/:id/revert")
  @RequirePermission("accounting.journal")
  revertJournal(@Param("id") id: string, @Identity() actor?: { userId: string }) {
    return this.journal.revertToDraft(id, actor?.userId);
  }

  /** پیوست‌های یک سند (فاز ۴) */
  @Get("journal/:id/attachments")
  @RequirePermission("accounting.view")
  async listAttachments(@Param("id") id: string) {
    return { items: await this.journal.listAttachments(id) };
  }

  @Post("journal/:id/attachments")
  @RequirePermission("accounting.journal")
  async addAttachment(
    @Param("id") id: string,
    @Body() body: { mediaId: string; title?: string },
    @Identity() actor?: { userId: string },
  ) {
    return this.journal.addAttachment(id, String(body.mediaId ?? "").trim(), body.title, actor?.userId);
  }

  @Delete("journal/attachments/:attachmentId")
  @RequirePermission("accounting.journal")
  async removeAttachment(
    @Param("attachmentId") attachmentId: string,
    @Identity() actor?: { userId: string },
  ) {
    return this.journal.removeAttachment(attachmentId, actor?.userId);
  }

  @Post("journal/:id/finalize")
  @RequirePermission("accounting.journal")
  finalize(@Param("id") id: string, @Identity() actor?: { userId: string }) {
    return this.journal.finalize(id, actor?.userId);
  }

  @Get("trial-balance")
  @RequirePermission("accounting.reports")
  trialBalance() {
    return this.journal.trialBalance();
  }

  @Get("integrity")
  @RequirePermission("accounting.view")
  integrity() {
    return this.journal.integrity();
  }

  /** فاز ۱۰ — بخش ۱۴: درخت حساب‌ها با توازن تجمعی از Ledger */
  @Get("accounts/tree")
  @RequirePermission("accounting.view")
  accountTree() {
    return this.journal.accountTree();
  }

  /** فاز ۱۰ — بخش ۱۴: ایجاد حساب فرزند */
  @Post("accounts/:id/children")
  @RequirePermission("accounting.journal")
  createChildAccount(
    @Param("id") id: string,
    @Body() body: { code?: string; name?: string },
    @Identity() actor?: { userId: string },
  ) {
    return this.journal.createChildAccount(id, { code: body.code ?? "", name: body.name ?? "" }, actor?.userId);
  }

  /** فاز ۱۰ — بخش ۱۴: فعال/غیرفعال‌سازی حساب */
  @Post("accounts/:id/active")
  @RequirePermission("accounting.journal")
  setAccountActive(
    @Param("id") id: string,
    @Body() body: { isActive?: boolean },
    @Identity() actor?: { userId: string },
  ) {
    return this.journal.setAccountActive(id, body.isActive !== false, actor?.userId);
  }

  /** فاز ۱۰ — بخش ۱۴: دفتر حساب (خطوط ژورنال یک حساب) */
  @Get("accounts/:id/ledger")
  @RequirePermission("accounting.view")
  async accountLedger(@Param("id") id: string, @Query() q: { page?: string }) {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = 25;
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account) throw new BadRequestException({ code: "NOT_FOUND", message: "حساب یافت نشد." });
    const [lines, total] = await this.prisma.$transaction([
      this.prisma.journalLine.findMany({
        where: { accountId: id },
        orderBy: { entry: { date: "desc" } },
        skip: (page - 1) * limit,
        take: limit,
        include: { entry: { select: { id: true, number: true, date: true, description: true, state: true } } },
      }),
      this.prisma.journalLine.count({ where: { accountId: id } }),
    ]);
    return {
      account: { id: account.id, code: account.code, name: account.name, type: account.type, isActive: account.isActive },
      items: lines.map((l) => ({
        entryId: l.entryId,
        entryNumber: l.entry.number,
        entryState: l.entry.state,
        date: l.entry.date,
        description: l.entry.description,
        debit: (l.debit ?? 0n).toString(),
        credit: (l.credit ?? 0n).toString(),
      })),
      total,
      page,
      limit,
    };
  }
}
