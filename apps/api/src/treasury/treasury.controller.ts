import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { RequirePermission } from "../auth/permissions.guard";
import { TreasuryService } from "./treasury.service";

/**
 * خزانه — نقد و بانک (فاز ۸، بند ۵۹–۶۲ Master).
 * مانده صندوق/بانک projection روی GL است؛ سندها از JournalService (بند ۱۰۷).
 */
@Controller("admin/treasury")
export class TreasuryController {
  constructor(private readonly treasury: TreasuryService) {}

  private actor(req: Request): string | undefined {
    const id = (req as unknown as Record<string, unknown>).adminIdentity as { userId?: string } | undefined;
    return id?.userId;
  }

  @Get("accounts")
  @RequirePermission("treasury.view")
  accounts() {
    return this.treasury.listAccounts();
  }

  @Get("summary")
  @RequirePermission("treasury.view")
  summary() {
    return this.treasury.summary();
  }

  @Post("cash-accounts")
  @RequirePermission("treasury.manage")
  createCashAccount(@Req() req: Request, @Body() body: { name: string; kind?: string; glAccountCode?: string; openingBalance?: number }) {
    return this.treasury.createCashAccount({ ...body, actorId: this.actor(req) });
  }

  @Post("bank-accounts")
  @RequirePermission("treasury.manage")
  createBankAccount(@Req() req: Request, @Body() body: { name: string; bankName: string; accountNumber: string; iban?: string; glAccountCode?: string; openingBalance?: number }) {
    return this.treasury.createBankAccount({ ...body, actorId: this.actor(req) });
  }

  @Post("cash-in")
  @RequirePermission("treasury.manage")
  cashIn(@Req() req: Request, @Body() body: { accountId: string; amount: number; counterAccountCode?: string; description?: string }) {
    return this.treasury.cashIn({ ...body, actorId: this.actor(req) });
  }

  @Post("cash-out")
  @RequirePermission("treasury.manage")
  cashOut(@Req() req: Request, @Body() body: { accountId: string; amount: number; counterAccountCode?: string; description?: string }) {
    return this.treasury.cashOut({ ...body, actorId: this.actor(req) });
  }

  @Post("transfer")
  @RequirePermission("treasury.manage")
  transfer(@Req() req: Request, @Body() body: { fromId: string; toId: string; amount: number; description?: string }) {
    return this.treasury.transfer({ ...body, actorId: this.actor(req) });
  }

  /** هزینه نقدی از دراوِر شیفت باز — مجوز فروش POS (صندوقدار) */
  @Post("pos-expense")
  @RequirePermission("pos.sell")
  posExpense(@Req() req: Request, @Body() body: { shiftId: string; amount: number; description?: string }) {
    return this.treasury.posExpense({ ...body, actorId: this.actor(req) });
  }

  @Get("pos-expenses/:shiftId")
  @RequirePermission("pos.view")
  posExpenses(@Param("shiftId") shiftId: string) {
    return this.treasury.posExpenses(shiftId);
  }

  @Get("bank-accounts/:id/statements")
  @RequirePermission("treasury.view")
  statements(@Param("id") id: string) {
    return this.treasury.listStatements(id);
  }

  @Post("bank-accounts/:id/statements/import")
  @RequirePermission("treasury.manage")
  importStatements(@Req() req: Request, @Param("id") id: string, @Body() body: { lines: Array<{ date: string; amount: number; description?: string }> }) {
    return this.treasury.importStatements({ bankAccountId: id, lines: body.lines ?? [], actorId: this.actor(req) });
  }

  @Post("bank-accounts/:id/statements/auto-match")
  @RequirePermission("treasury.manage")
  autoMatch(@Req() req: Request, @Param("id") id: string) {
    return this.treasury.autoMatch(id, this.actor(req));
  }
}
