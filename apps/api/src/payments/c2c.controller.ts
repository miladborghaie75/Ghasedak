import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RequirePermission } from "../auth/permissions.guard";
import { Identity } from "../auth/identity.decorator";
import type { AdminIdentity } from "../auth/auth.service";
import { C2cService, type C2cDecisionAction } from "./c2c.service";

/**
 * گام ۱۸-۱ — کنترلر کارت‌به‌کارت.
 *
 * عمومی (فروشگاه): پیکربندی/ثبت رسید/وضعیت — همه فقط با دانستن کد سفارش
 * (همان سطح اعتماد pay/start) و تحت سوییچ خاموش‌شدنی.
 * ادمین: صف رسیدها (payments.view)، تصمیم (payments.verify)،
 * مدیریت کارت‌ها و سوییچ (payments.manage).
 */

const CARD_RE = /^\d{16}$/;
const IBAN_RE = /^IR\d{24}$/;

interface AccountBody {
  bankName?: string;
  holderName?: string;
  cardNumber?: string;
  iban?: string;
  displayTitle?: string;
  customerInstructions?: string;
  visibleFields?: string[];
  active?: boolean;
  sortOrder?: number;
}

function validateAccount(body: AccountBody): { bankName: string; holderName: string; cardNumber: string } {
  const bankName = body.bankName?.trim() ?? "";
  const holderName = body.holderName?.trim() ?? "";
  const card = (body.cardNumber ?? "").replace(/\D/g, "");
  if (!bankName || !holderName) {
    throw new BadRequestException({ code: "VALIDATION_ERROR", message: "نام بانک و نام صاحب حساب لازم است." });
  }
  if (!CARD_RE.test(card)) {
    throw new BadRequestException({ code: "VALIDATION_ERROR", message: "شماره کارت باید ۱۶ رقم باشد." });
  }
  if (body.iban != null && body.iban !== "" && !IBAN_RE.test(body.iban.replace(/\s/g, "").toUpperCase())) {
    throw new BadRequestException({ code: "VALIDATION_ERROR", message: "شماره شبا باید به شکل IR و ۲۴ رقم باشد." });
  }
  if (body.visibleFields != null) {
    const allowed = new Set(["bankName", "holderName", "cardNumber", "iban"]);
    for (const f of body.visibleFields) {
      if (!allowed.has(f)) {
        throw new BadRequestException({ code: "VALIDATION_ERROR", message: `فیلد نمایشی نامعتبر: ${f}` });
      }
    }
  }
  return { bankName, holderName, cardNumber: card };
}

@Controller("payments")
export class C2cController {
  constructor(
    private readonly c2c: C2cService,
    private readonly prisma: PrismaService,
  ) {}

  // ── عمومی ────────────────────────────────────────────────────────────

  /** پیکربندی عمومی — کارت‌های ماسک‌شده فقط وقتی سوییچ روشن است */
  @Get("c2c/config")
  async config() {
    return this.c2c.publicConfig();
  }

  /** ثبت رسید واریز — مشتری با کد سفارش (همان اعتماد pay/start) */
  @Post("c2c/submit")
  async submit(@Body() body: {
    orderCode?: string;
    idempotencyKey?: string;
    referenceNo?: string;
    transferDate?: string;
    transferTime?: string;
    sourceBank?: string;
    note?: string;
  }) {
    if (!body.orderCode || !body.idempotencyKey) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "کد سفارش و کلید تلاش لازم است." });
    }
    return this.c2c.submit({
      orderCode: body.orderCode,
      idempotencyKey: body.idempotencyKey,
      referenceNo: body.referenceNo,
      transferDate: body.transferDate,
      transferTime: body.transferTime,
      sourceBank: body.sourceBank,
      note: body.note,
    });
  }

  /** وضعیت آخرین رسید سفارش — برای صفحهٔ پرداخت مشتری */
  @Get("c2c/by-order/:code")
  async byOrder(@Param("code") code: string) {
    const row = await this.c2c.latestForOrder(code);
    if (!row) throw new BadRequestException({ code: "NO_SUBMISSION", message: "رسیدی برای این سفارش ثبت نشده است." });
    return row;
  }

  // ── ادمین: صف و تصمیم ──────────────────────────────────────────────

  @Get("admin/c2c/list")
  @RequirePermission("payments.view")
  async list(@Query() q: { state?: string; page?: string }) {
    return this.c2c.adminList(q);
  }

  @Post("admin/c2c/:id/decision")
  @RequirePermission("payments.verify")
  async decision(
    @Param("id") id: string,
    @Body() body: { action?: string; note?: string },
    @Identity() user: AdminIdentity,
  ) {
    const action = body.action as C2cDecisionAction;
    if (action !== "APPROVE" && action !== "REJECT" && action !== "CORRECTION") {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "تصمیم باید تأیید، رد یا اصلاح باشد." });
    }
    return this.c2c.decide({ submissionId: id, action, adminId: user.userId, note: body.note });
  }

  // ── ادمین: کارت‌های فروشگاه ────────────────────────────────────────

  @Get("admin/c2c/accounts")
  @RequirePermission("payments.view")
  async accounts() {
    const rows = await this.prisma.cardToCardAccount.findMany({ orderBy: { sortOrder: "asc" } });
    return {
      items: rows.map((a) => ({
        id: a.id,
        bankName: a.bankName,
        holderName: a.holderName,
        cardNumber: a.cardNumber,
        iban: a.iban,
        displayTitle: a.displayTitle,
        customerInstructions: a.customerInstructions,
        visibleFields: a.visibleFields,
        active: a.active,
        sortOrder: a.sortOrder,
        submissions: 0,
      })),
    };
  }

  @Post("admin/c2c/accounts")
  @RequirePermission("payments.manage")
  async createAccount(@Body() body: AccountBody) {
    const v = validateAccount(body);
    const row = await this.prisma.cardToCardAccount.create({
      data: {
        bankName: v.bankName,
        holderName: v.holderName,
        cardNumber: v.cardNumber,
        iban: body.iban?.trim() || null,
        displayTitle: body.displayTitle?.trim() || null,
        customerInstructions: body.customerInstructions?.trim() || null,
        visibleFields: body.visibleFields ?? ["bankName", "holderName", "cardNumber", "iban"],
        active: body.active ?? true,
        sortOrder: body.sortOrder ?? 0,
      },
    });
    return { id: row.id };
  }

  @Patch("admin/c2c/accounts/:id")
  @RequirePermission("payments.manage")
  async updateAccount(@Param("id") id: string, @Body() body: AccountBody) {
    const row = await this.prisma.cardToCardAccount.findUnique({ where: { id } });
    if (!row) throw new BadRequestException({ code: "NOT_FOUND", message: "کارت یافت نشد." });
    const v =
      body.cardNumber != null || body.bankName != null || body.holderName != null
        ? validateAccount({
            bankName: body.bankName ?? row.bankName,
            holderName: body.holderName ?? row.holderName,
            cardNumber: body.cardNumber ?? row.cardNumber,
            iban: body.iban ?? row.iban ?? "",
            visibleFields: Array.isArray(body.visibleFields) ? body.visibleFields : undefined,
          })
        : null;
    const updated = await this.prisma.cardToCardAccount.update({
      where: { id },
      data: {
        ...(v ? { bankName: v.bankName, holderName: v.holderName, cardNumber: v.cardNumber } : {}),
        ...(body.iban !== undefined ? { iban: body.iban?.trim() || null } : {}),
        ...(body.displayTitle !== undefined ? { displayTitle: body.displayTitle?.trim() || null } : {}),
        ...(body.customerInstructions !== undefined ? { customerInstructions: body.customerInstructions?.trim() || null } : {}),
        ...(body.visibleFields !== undefined ? { visibleFields: body.visibleFields } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      },
    });
    return { id: updated.id, active: updated.active };
  }

  /** حذف فقط وقتی رسیدی به آن وصل نیست — وگرنه غیرفعال کردن راه درست است */
  @Delete("admin/c2c/accounts/:id")
  @RequirePermission("payments.manage")
  async deleteAccount(@Param("id") id: string) {
    const used = await this.prisma.cardToCardSubmission.count({ where: { destAccountId: id } });
    if (used > 0) {
      throw new BadRequestException({
        code: "ACCOUNT_IN_USE",
        message: "این کارت رسید ثبت‌شده دارد و حذف نمی‌شود؛ آن را غیرفعال کن.",
      });
    }
    await this.prisma.cardToCardAccount.delete({ where: { id } });
    return { ok: true };
  }

  // ── ادمین: سوییچ (تصمیم #۱۴) ────────────────────────────────────────

  @Get("admin/c2c/settings")
  @RequirePermission("payments.view")
  async settings() {
    return { enabled: await this.c2c.isEnabled() };
  }

  @Patch("admin/c2c/settings")
  @RequirePermission("payments.manage")
  async updateSettings(@Body() body: { enabled?: boolean }) {
    if (typeof body.enabled !== "boolean") {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "مقدار فعال/غیرفعال لازم است." });
    }
    return { enabled: await this.c2c.setEnabled(body.enabled) };
  }

  @Get("admin/c2c/stats")
  @RequirePermission("payments.view")
  async stats() {
    const [pending, approved, rejected] = await this.prisma.$transaction([
      this.prisma.cardToCardSubmission.count({ where: { state: "PENDING_VERIFICATION" } }),
      this.prisma.cardToCardSubmission.count({ where: { state: "APPROVED" } }),
      this.prisma.cardToCardSubmission.count({ where: { state: "REJECTED" } }),
    ]);
    return { pending, approved, rejected };
  }
}
