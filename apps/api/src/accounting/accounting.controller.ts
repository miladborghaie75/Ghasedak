import { Body, Controller, Get, Post } from "@nestjs/common";
import { JournalService, type PostEntryInput } from "./journal.service";
import { RequirePermission } from "../auth/permissions.guard";

@Controller("admin/accounting")
export class AccountingController {
  constructor(private readonly journal: JournalService) {}

  @Post("journal")
  @RequirePermission("accounting.journal")
  post(@Body() body: PostEntryInput) {
    return this.journal.post(body);
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
}
