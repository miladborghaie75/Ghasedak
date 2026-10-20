import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  NEED_FINDER_FALLBACK,
  type NeedFinderOptionDTO,
  type NeedFinderStepDTO,
  type NeedRule,
} from "@ghasedak/contracts";

/**
 * API عمومی ویزارد «چی لازم داری؟» (گام ۱۶ / بند ۹+۲۰).
 * بدون احراز هویت — فروشگاه عمومی است؛ فقط گام‌ها/گزینه‌های active.
 * اگر DB خالی بود (مثلاً قبل از seed) همان fallback تک‌منبع از contracts
 * برگردانده می‌شود تا فروشگاه هرگز بدون ویزارد بالا نیاید.
 */
@Controller("need-finder")
export class NeedFinderController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("steps")
  async steps(): Promise<NeedFinderStepDTO[]> {
    const rows = await this.prisma.needFinderStep.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        question: true,
        options: {
          where: { active: true },
          orderBy: { sortOrder: "asc" },
          select: { id: true, label: true, icon: true, rule: true },
        },
      },
    });
    if (!rows.length) return NEED_FINDER_FALLBACK;
    return rows.map((s) => ({
      id: s.id,
      question: s.question,
      options: s.options.map<NeedFinderOptionDTO>((o) => ({
        id: o.id,
        label: o.label,
        icon: o.icon,
        rule: (o.rule as NeedRule | null) ?? null,
      })),
    }));
  }
}
