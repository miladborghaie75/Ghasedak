import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { ImportService } from "./import.service";
import { RequirePermission } from "../auth/permissions.guard";
import { Identity } from "../auth/identity.decorator";
import { CSV_BOM, csvFilename, toCsv } from "../accounting/csv";
import { COLUMNS, COLUMN_LABELS } from "./csv-parse";

/**
 * ورود گروهی محصولات (گام ۱۳ · `[F1-3]`).
 *
 * قالب نمونه با همان نویسندهٔ CSV گام ۱۲ ساخته می‌شود — BOM برای Excel فارسی
 * و خنثی‌سازی تزریق فرمول. اگر فردا ستونی اضافه شد، همین یک جا عوض می‌شود.
 */
@Controller("admin/import")
export class ImportController {
  constructor(private readonly service: ImportService) {}

  /** قالب نمونه — فقط سرستون‌ها، بدون ردیف نمونه (ردیف نمونه اشتباهی وارد می‌شود) */
  @Get("template")
  @RequirePermission("products.view")
  template(@Res() res: Response): void {
    const header = COLUMNS.map((c) => COLUMN_LABELS[c]);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="${csvFilename("products-import-template")}"`);
    res.send(CSV_BOM + toCsv([header]));
  }

  /** تاریخچهٔ دسته‌ها — برای پیدا کردن دستهٔ قابل بازگردانی */
  @Get()
  @RequirePermission("products.view")
  list(@Query("limit") limit?: string) {
    const n = Number(limit ?? 10);
    return this.service.list(Number.isFinite(n) ? n : 10);
  }

  /**
   * پیش‌نمایش — فایل به‌صورت متن UTF-8 در بدنه می‌آید.
   * سقف حجم/ردیف در سرویس چک می‌شود، نه اینجا.
   */
  @Post("preview")
  @RequirePermission("products.view")
  preview(
    @Body() body: { filename?: string; text?: string; kind?: string },
    @Identity() actor?: { userId: string } | null,
  ) {
    return this.service.preview({
      filename: body?.filename,
      text: String(body?.text ?? ""),
      kind: body?.kind,
      actorId: actor?.userId,
    });
  }

  /**
   * اعمال — هم ایجاد و هم ویرایش محصول را می‌نویسد، پس هر دو مجوز لازم است.
   * (نگهبان مجوز، همهٔ موارد اعلام‌شده را با هم می‌خواهد.)
   */
  @Post(":batchId/apply")
  @HttpCode(200)
  @RequirePermission("products.create", "products.update")
  apply(@Param("batchId") batchId: string, @Identity() actor?: { userId: string } | null) {
    return this.service.apply(batchId, actor?.userId);
  }

  /** بازگردانی — ویرایش به عقب؛ مجوز ویرایش کافی است */
  @Post(":batchId/revert")
  @HttpCode(200)
  @RequirePermission("products.update")
  revert(@Param("batchId") batchId: string, @Identity() actor?: { userId: string } | null) {
    return this.service.revert(batchId, actor?.userId);
  }

  @Get(":batchId")
  @RequirePermission("products.view")
  detail(@Param("batchId") batchId: string) {
    return this.service.get(batchId);
  }
}
