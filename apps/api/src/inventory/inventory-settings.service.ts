import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { INVENTORY_SETTINGS, type InventorySettingDef } from "./inventory-settings";

/**
 * سرویس تنظیمات انبار — مقدار هر کلید از DB؛ در نبود ردیف default اعمال می‌شود.
 * نوشتن فقط با validation سمت سرور (min/max/type) انجام می‌شود (قانون ۶).
 */
@Injectable()
export class InventorySettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private def(key: string): InventorySettingDef {
    const d = INVENTORY_SETTINGS.find((s) => s.key === key);
    if (!d) throw new BadRequestException({ code: "UNKNOWN_SETTING", message: `تنظیم «${key}» تعریف نشده است.` });
    return d;
  }

  /** مقدار یک کلید با fallback به default — هر سرویس انبار از همین می‌خواند */
  async get<T = number | boolean | string>(key: string): Promise<T> {
    const d = this.def(key);
    const row = await this.prisma.inventorySetting.findUnique({ where: { key } });
    if (!row) return d.default as T;
    return row.value as T;
  }

  async getAll(): Promise<Array<{ key: string; value: unknown; type: string; defaultValue: unknown; description: string; updatedBy: string | null; updatedAt: Date | null }>> {
    const rows = await this.prisma.inventorySetting.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return INVENTORY_SETTINGS.map((d) => {
      const r = byKey.get(d.key);
      return {
        key: d.key,
        value: r?.value ?? d.default,
        type: d.type,
        defaultValue: d.default,
        description: d.description,
        updatedBy: r?.updatedBy ?? null,
        updatedAt: r?.updatedAt ?? null,
      };
    });
  }

  /** نوشتن با validation کامل — فقط کلیدهای تعریف‌شده */
  async set(key: string, value: unknown, actorId?: string): Promise<void> {
    const d = this.def(key);
    const validated = this.validate(d, value);
    await this.prisma.inventorySetting.upsert({
      where: { key },
      update: { value: validated as unknown as object, updatedBy: actorId ?? null },
      create: {
        key,
        value: validated as unknown as object,
        valueType: d.type,
        defaultValue: d.default as unknown as object,
        description: d.description,
        updatedBy: actorId ?? null,
      },
    });
  }

  private validate(d: InventorySettingDef, value: unknown): number | boolean | string {
    if (d.type === "number") {
      const n = Number(value);
      if (!Number.isSafeInteger(n)) throw new BadRequestException({ code: "VALIDATION_ERROR", message: `«${d.key}» باید عدد صحیح باشد.` });
      if (d.min !== undefined && n < d.min) throw new BadRequestException({ code: "VALIDATION_ERROR", message: `«${d.key}» حداقل ${d.min} است.` });
      if (d.max !== undefined && n > d.max) throw new BadRequestException({ code: "VALIDATION_ERROR", message: `«${d.key}» حداکثر ${d.max} است.` });
      return n;
    }
    if (d.type === "boolean") {
      if (typeof value !== "boolean") throw new BadRequestException({ code: "VALIDATION_ERROR", message: `«${d.key}» باید true/false باشد.` });
      return value;
    }
    if (typeof value !== "string" || !value.trim()) throw new BadRequestException({ code: "VALIDATION_ERROR", message: `«${d.key}» باید متن غیرخالی باشد.` });
    return value.trim();
  }
}
