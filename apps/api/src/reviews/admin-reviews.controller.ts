import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { RequirePermission } from "../auth/permissions.guard";
import { Identity } from "../auth/identity.decorator";
import { ReviewsService } from "./reviews.service";

/**
 * صف مدیریت نظرات (گام ۱۱) — مجوز `reviews.moderate` (بند ۷: چک server-side).
 * هر اقدام AuditLog با قبل/بعد می‌گیرد (در سرویس) — بدون استثنا.
 */
@Controller("reviews/admin")
@RequirePermission("reviews.moderate")
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  /** صف بر اساس وضعیت + جستجو + شمارنده‌ها برای تب‌ها */
  @Get("queue")
  queue(@Query() q: { status?: string; page?: string; q?: string }) {
    return this.reviews.queue({ status: q.status, page: q.page ? Number(q.page) : 1, q: q.q });
  }

  @Post(":id/approve")
  approve(@Param("id") id: string, @Identity() actor?: { userId: string }) {
    return this.reviews.moderate(id, "approve", actor?.userId ?? null);
  }

  @Post(":id/reject")
  reject(@Param("id") id: string, @Identity() actor?: { userId: string }) {
    return this.reviews.moderate(id, "reject", actor?.userId ?? null);
  }

  @Post(":id/hide")
  hide(@Param("id") id: string, @Identity() actor?: { userId: string }) {
    return this.reviews.moderate(id, "hide", actor?.userId ?? null);
  }

  @Post(":id/reply")
  reply(@Param("id") id: string, @Body() body: { reply?: string }, @Identity() actor?: { userId: string }) {
    return this.reviews.moderate(id, "reply", actor?.userId ?? null, { reply: body.reply });
  }
}
