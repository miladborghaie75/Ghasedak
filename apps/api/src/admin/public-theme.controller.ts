import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** تم عمومی فروشگاه — فقط فیلدهای ایمن؛ بدون credential (بند ۴۴) */
@Controller("admin/public")
export class PublicThemeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("theme")
  async theme() {
    const row = await this.prisma.setting.findUnique({ where: { key: "theme" } });
    if (!row) return {};
    const v = row.value as Record<string, unknown>;
    // فقط فیلدهای ظاهری ایمن
    return {
      primary: typeof v.primary === "string" ? v.primary : undefined,
      ink: typeof v.ink === "string" ? v.ink : undefined,
      bg: typeof v.bg === "string" ? v.bg : undefined,
      fontHeading: typeof v.fontHeading === "string" ? v.fontHeading : undefined,
      fontBody: typeof v.fontBody === "string" ? v.fontBody : undefined,
      storeName: typeof v.storeName === "string" ? v.storeName : undefined,
    };
  }

  /** تنظیمات موشن لندینگ — عمومی و ایمن */
  @Get("motion")
  async motion() {
    const row = await this.prisma.setting.findUnique({ where: { key: "motion" } });
    if (!row) return { enabled: true, intensity: "subtle" };
    const v = row.value as Record<string, unknown>;
    return {
      enabled: v.enabled !== false,
      intensity: v.intensity === "playful" ? "playful" : "subtle",
    };
  }

  /** سکشن‌های صفحه اصلی از صفحه‌ساز زنده (`/cms/page/home`) می‌آیند؛ این مسیر حذف شد. */

  /**
   * وضعیت تعمیر فروشگاه (گام ۱۰) — عمومی و ایمن؛ فقط enabled/پیام/مهلت.
   * فروشگاه با همین مسیر تصمیم می‌گیرد صفحهٔ اطلاع نشان بدهد؛ پیش‌فرض خاموش.
   */
  @Get("maintenance")
  async maintenance() {
    const row = await this.prisma.setting.findUnique({ where: { key: "maintenance" } });
    if (!row) return { enabled: false };
    const v = row.value as Record<string, unknown>;
    return {
      enabled: v.enabled === true,
      message: typeof v.message === "string" && v.message.trim() ? v.message : undefined,
      until: typeof v.until === "string" && v.until.trim() ? v.until : undefined,
    };
  }
}
