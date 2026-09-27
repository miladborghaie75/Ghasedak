import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { RequirePermission } from "../auth/permissions.guard";
import { ChecksService } from "./checks.service";

/** فاز ۹ — Wave 2: endpointهای دامنهٔ چک — هر مسیر با permissionهای checks.* گارد می‌خورد */
@Controller("admin/checks")
export class ChecksController {
  constructor(private readonly checks: ChecksService) {}

  private actor(req: Request): string | undefined {
    const id = (req as unknown as Record<string, unknown>).adminIdentity as { userId?: string } | undefined;
    return id?.userId;
  }

  @Get()
  @RequirePermission("checks.view")
  list(@Query() q: { status?: string; direction?: string; dueBefore?: string; take?: string }) {
    return this.checks.list({
      status: q.status,
      direction: q.direction,
      dueBefore: q.dueBefore,
      take: q.take ? Number(q.take) : undefined,
    });
  }

  @Get(":id")
  @RequirePermission("checks.view")
  get(@Param("id") id: string) {
    return this.checks.get(id);
  }

  /** گذار عمومی lifecycle — بهStatus هر مقداری که allow-list اجازه دهد */
  @Post(":id/transition")
  @RequirePermission("checks.manage")
  transition(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: { toStatus: string; idempotencyKey: string; reason?: string; requestId?: string; effectiveAt?: string },
  ) {
    return this.checks.transition({
      checkId: id,
      toStatus: body.toStatus,
      idempotencyKey: body.idempotencyKey,
      reason: body.reason,
      requestId: body.requestId,
      effectiveAt: body.effectiveAt ? new Date(body.effectiveAt) : undefined,
      actorId: this.actor(req),
    });
  }

  /** وصول — فقط یک‌بار؛ destructive نیست (پول واقعاً وارد می‌شود) */
  @Post(":id/clear")
  @RequirePermission("checks.clear")
  clear(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: { idempotencyKey: string; effectiveAt?: string; bankStatementId?: string; reason?: string },
  ) {
    return this.checks.clear({
      checkId: id,
      idempotencyKey: body.idempotencyKey,
      effectiveAt: body.effectiveAt ? new Date(body.effectiveAt) : undefined,
      bankStatementId: body.bankStatementId,
      reason: body.reason,
      actorId: this.actor(req),
    });
  }

  /** برگشت چک — destructive؛ confirmation در UI */
  @Post(":id/bounce")
  @RequirePermission("checks.manage")
  bounce(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: { idempotencyKey: string; reason?: string },
  ) {
    return this.checks.bounce({ checkId: id, idempotencyKey: body.idempotencyKey, reason: body.reason, actorId: this.actor(req) });
  }

  /** ابطال — فقط چک صادره؛ destructive؛ confirmation در UI */
  @Post(":id/cancel")
  @RequirePermission("checks.cancel")
  cancel(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: { idempotencyKey: string; reason?: string },
  ) {
    return this.checks.cancel({ checkId: id, idempotencyKey: body.idempotencyKey, reason: body.reason, actorId: this.actor(req) });
  }

  /** تاریخچهٔ lifecycle — بخشی از audit trail (CheckTransition) */
  @Get(":id/transitions")
  @RequirePermission("checks.view")
  transitions(@Param("id") id: string) {
    return this.checks.get(id);
  }
}
