import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { Identity } from "../auth/identity.decorator";
import { RequirePermission } from "../auth/permissions.guard";
import { PhotographyService } from "./photography.service";

/**
 * API برنامهٔ عکاسی (گام ۲۰) — فقط برای پنل ادمین.
 *
 * خواندن با `products.view` و نوشتن با `products.update`: پیوست و تأییدِ عکس
 * در عمل تصویرِ محصول را عوض می‌کند، پس همان مجوزِ ویرایشِ محصول می‌خواهد.
 */
@Controller("admin/photography")
export class PhotographyController {
  constructor(private readonly photography: PhotographyService) {}

  /** تابلوی برنامه — دسته‌ها، محصولات، کادرها و وضعیتِ هر کادر */
  @Get("board")
  @RequirePermission("products.view")
  async board() {
    return this.photography.board();
  }

  /** پیوستِ عکس به یک کادرِ یک محصول */
  @Post("products/:productId/shots/:shotKind")
  @RequirePermission("products.update")
  async attach(
    @Param("productId") productId: string,
    @Param("shotKind") shotKind: string,
    @Body() body: { mediaId?: string; note?: string | null },
    @Identity() actor?: { userId: string } | null,
  ) {
    return this.photography.attachShot(productId, shotKind, body, actor?.userId);
  }

  /**
   * تأییدِ گروهی — یک درخواست برای چند کادرِ آماده (چند محصول یا یک محصول).
   *
   * نتیجه هر کار جدا برمی‌گردد (تأییدشده‌ها + دلیلِ ناموفق‌ها)؛ عمداً همه‌یا‌هیچ
   * نیست تا یک شناسهٔ کهنه بقیهٔ کارهای سالم را برنگرداند.
   */
  @Post("tasks/approve")
  @RequirePermission("products.update")
  async approveMany(@Body() body: { taskIds?: string[] }, @Identity() actor?: { userId: string } | null) {
    return this.photography.approveMany(body?.taskIds, actor?.userId);
  }

  /** تأییدِ عکس — عکسِ «نمای صافِ جلو» خودکار عکسِ اصلیِ محصول می‌شود */
  @Post("tasks/:taskId/approve")
  @RequirePermission("products.update")
  async approve(@Param("taskId") taskId: string, @Identity() actor?: { userId: string } | null) {
    return this.photography.approveTask(taskId, actor?.userId);
  }

  /** عکسِ دوباره — عکسِ ردشده حذف و محصول (اگر لازم باشد) به آرت برمی‌گردد */
  @Post("tasks/:taskId/retake")
  @RequirePermission("products.update")
  async retake(
    @Param("taskId") taskId: string,
    @Body() body: { note?: string | null },
    @Identity() actor?: { userId: string } | null,
  ) {
    return this.photography.retakeTask(taskId, body, actor?.userId);
  }
}
