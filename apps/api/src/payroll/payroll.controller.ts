import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { PayrollService } from "./payroll.service";
import { RequirePermission } from "../auth/permissions.guard";
import { Identity } from "../auth/identity.decorator";

/** حقوق و دستمزد — گام ۷ فاز ۲ */
@Controller("admin/payroll")
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get("accounts")
  @RequirePermission("accounting.view")
  accounts() {
    return this.payroll.accounts();
  }

  // ---------------- قراردادها ----------------

  @Get("contracts")
  @RequirePermission("accounting.view")
  listContracts(@Query("all") all?: string) {
    return this.payroll.listContracts(all !== "1");
  }

  @Post("contracts")
  @RequirePermission("accounting.journal")
  saveContract(
    @Body()
    body: {
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
    },
  ) {
    return this.payroll.saveContract(body);
  }

  @Delete("contracts/:id")
  @RequirePermission("accounting.journal")
  endContract(@Param("id") id: string) {
    return this.payroll.endContract(id);
  }

  // ---------------- لیست ماه ----------------

  @Get("runs")
  @RequirePermission("accounting.view")
  listRuns() {
    return this.payroll.listRuns();
  }

  /** ساخت پیش‌نویس ماه از قراردادهای فعال (یا بازسازی پیش‌نویس قبلی) */
  @Post("runs")
  @RequirePermission("accounting.journal")
  buildRun(@Body() body: { period: string; title?: string }) {
    return this.payroll.buildRun(body.period, body.title);
  }

  @Get("runs/:id")
  @RequirePermission("accounting.view")
  getRun(@Param("id") id: string) {
    return this.payroll.getRun(id);
  }

  /** ویرایش دستی ردیف — کنترل دستی مدیر حفظ می‌شود */
  @Put("items/:id")
  @RequirePermission("accounting.journal")
  updateItem(@Param("id") id: string, @Body() body: { gross?: number; deduction?: number }) {
    return this.payroll.updateItem(id, body);
  }

  @Delete("runs/:id")
  @RequirePermission("accounting.journal")
  deleteRun(@Param("id") id: string) {
    return this.payroll.deleteRun(id);
  }

  /** ثبت سند حسابداری حقوق */
  @Post("runs/:id/post")
  @RequirePermission("accounting.journal")
  postJournal(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: { cashAccountId?: string },
    @Identity() actor?: { userId: string },
  ) {
    void req;
    return this.payroll.postJournal(id, actor?.userId, body.cashAccountId);
  }
}