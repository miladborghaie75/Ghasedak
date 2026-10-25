import { Injectable } from "@nestjs/common";
import { existsSync, accessSync, constants } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { mediaDir } from "../common/media-dir";

/**
 * سلامت اجزا (بند ۸۸ — اصلاح گام ۲۳).
 *
 * باگ قبلی: `redis`/`storage` هاردکد `false` بودند و چون status از AND هر سه
 * می‌آمد، پاسخ همیشه `degraded` بود — یعنی هیچ ابزار uptimeی نمی‌توانست رویش
 * هشدار بگذارد. حالا:
 *  - چک الزامی فقط `db` است (SELECT 1) → با DB سبز، `status = "ok"`.
 *  - `redis`/`storage` چک‌های اطلاعاتی‌اند و در status دخیل نیستند
 *    (redis عملاً در این پروژه فعال نیست؛ storage با existence-check سبک پوشهٔ رسانه واقعی است).
 *  - `version` (از package.json اپ) و `uptimeSeconds` برای گزارش پایش.
 */
@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async getStatus(): Promise<{
    status: "ok" | "degraded";
    checks: { api: boolean; db: boolean; redis: boolean; storage: boolean };
    version: string;
    uptimeSeconds: number;
  }> {
    let db = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }
    const redis = false; // در این پروژه redis فعال نیست — چک اطلاعاتی، بدون اثر روی status
    const storage = mediaStorageOk(); // وجود/نوشتنی‌بودن پوشهٔ رسانه — فقط خواندن (هیچ پوشه‌ای ساخته نمی‌شود)

    return {
      // فقط db ملاک سلامت است؛ redis/storage در `checks` گزارش می‌شوند نه verdict
      status: db ? "ok" : "degraded",
      checks: { api: true, db, redis, storage },
      version: appVersion(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}

/** نسخهٔ اپ از package.json — در dev (src/health) و build (dist/health) هر دو دو سطح بالاتر است */
function appVersion(): string {
  try {
    const raw = readFileSync(join(__dirname, "..", "..", "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * چک سبک رسانه — فقط خواندن: وجود + قابل‌نوشتن‌بودن. برخلاف `mediaDirReady()`
 * هیچ پوشه‌ای نمی‌سازد تا health کاملاً read-only بماند (پوشهٔ غایب باید همان
 * غایب دیده شود — باگی که تست checkStorage را می‌شکست).
 */
function mediaStorageOk(): boolean {
  try {
    const dir = mediaDir();
    if (!existsSync(dir)) return false;
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
