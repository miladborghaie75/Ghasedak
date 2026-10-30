import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { promises as fs } from "node:fs";
import { HealthService } from "../health/health.service";
import { backgroundWorkersEnabled } from "../common/background-workers";
import { mediaDir } from "../common/media-dir";
import { emitAlert } from "./alert-bus";
import { BACKUP_DIR, listBackupDirs, readBackupDirInfo } from "../admin/backup-status.controller";

/**
 * پایشگر دوره‌ای (گام ۲۳ — بستهٔ C): سه چک واقعی که به رأس هشدار وصل‌اند.
 *
 *  ۱) health خودِ سیستم هر ۱ دقیقه — دو خرابی پشت‌سرهم → هشدار HEALTH_DOWN
 *     (یک خطا ممکن است فقط پرش شبکه باشد؛ دو تا پشت‌سرهم یعنی واقعاً پایین است).
 *  ۲) فضای دیسک پارتیشن داده هر ۵ دقیقه — بیش از ۸۵٪ پر → هشدار DISK_HIGH.
 *  ۳) تازگی/سلامت بکاپ هر ۶۰ دقیقه — آخرین manifest ناقص/بدون verify → BACKUP_FAILED.
 *     (بکاپ خودِ تسک ویندوزی می‌گیرد؛ اینجا فقط وضعیت واقعی دیسک خوانده می‌شود.)
 *
 * همه با گیت `GHASEDAK_WORKERS=off` خاموش می‌شوند — همان قاعدهٔ event-bus/dispatcher.
 */
@Injectable()
export class HealthWatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HealthWatchService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private tick = 0;
  /** خرابی‌های پشت‌سرهم health — ریست فقط با بازیابی */
  private consecutiveFailures = 0;
  private diskWarned = false;

  constructor(private readonly health: HealthService) {}

  onModuleInit(): void {
    if (!backgroundWorkersEnabled()) {
      this.logger.log("Background workers disabled (GHASEDAK_WORKERS=off) — HealthWatch timer not started");
      return;
    }
    this.timer = setInterval(
      () => void this.run().catch((e) => this.logger.warn(`health watch failed: ${e instanceof Error ? e.message : e}`)),
      60_000,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** یک پاس — عمومی برای تست */
  async run(): Promise<void> {
    this.tick += 1;
    await this.checkHealth().catch((e) =>
      this.logger.warn(`health-watch error: ${e instanceof Error ? e.message : String(e)}`),
    );
    if (this.tick % 5 === 0) {
      await this.checkDisk().catch((e) =>
        this.logger.warn(`disk-check error: ${e instanceof Error ? e.message : String(e)}`),
      );
    }
    if (this.tick % 60 === 0) {
      await this.checkBackup().catch((e) =>
        this.logger.warn(`backup-check error: ${e instanceof Error ? e.message : String(e)}`),
      );
    }
  }

  private async checkHealth(): Promise<void> {
    const s = await this.health.getStatus();
    if (s.checks.db) {
      if (this.consecutiveFailures >= 2) {
        // بازیابی بعد از هشدار — لاگ ساخت‌یافته تا مشخص شد مشکل رفع شده
        this.logger.log(
          JSON.stringify({ component: "health-watch", status: "RECOVERED", afterFailures: this.consecutiveFailures }),
        );
      }
      this.consecutiveFailures = 0;
      return;
    }
    this.consecutiveFailures += 1;
    this.logger.warn(
      JSON.stringify({ component: "health-watch", status: "DB_DOWN", consecutiveFailures: this.consecutiveFailures }),
    );
    if (this.consecutiveFailures >= 2) {
      emitAlert(
        "HEALTH_DOWN",
        `دیتابیس در ${this.consecutiveFailures} بررسی پشت‌سرهم در دسترس نیست — سایت عملاً از کار افتاده است.`,
        { endpoint: "GET /api/v1/health", consecutiveFailures: this.consecutiveFailures },
      );
    }
  }

  private async checkDisk(): Promise<void> {
    const usage = await diskUsagePercent(mediaDir());
    if (usage == null) {
      this.logger.debug("disk-check: پشتیبانی نمی‌شود/در دسترس نیست — SKIP");
      return;
    }
    const percent = Math.round(usage * 100) / 100;
    if (usage >= 0.85) {
      if (!this.diskWarned) {
        emitAlert("DISK_HIGH", `فضای دیسک پارتیشن داده ${percent}٪ پر شده (آستانه ۸۵٪).`, { usedPercent: percent, dir: mediaDir() });
        this.diskWarned = true;
      }
      return;
    }
    this.diskWarned = false; // پایین آمد از آستانه → اجازهٔ هشدار بعدی
  }

  private async checkBackup(): Promise<void> {
    let names: string[] = [];
    try {
      names = listBackupDirs(BACKUP_DIR);
    } catch {
      this.logger.debug("backup-check: پوشهٔ بکاپ خوانده نمی‌شود — SKIP (بکاپ بیرونی؟ در deploy-guide مستند است)");
      return;
    }
    if (names.length === 0) return; // هنوز بکاپی گرفته نشده — هشدار جعلی نمی‌سازیم
    const latest = readBackupDirInfo(BACKUP_DIR, names[names.length - 1]);
    if (!latest) {
      emitAlert("BACKUP_FAILED", `manifest آخرین بکاپ («${names[names.length - 1]}») خراب/نامشخص است.`, { dir: BACKUP_DIR });
      return;
    }
    if (!latest.complete || !latest.verifyOk) {
      emitAlert(
        "BACKUP_FAILED",
        `آخرین بکاپ («${latest.name}») سالم ثبت نشده — complete=${latest.complete} verifyOk=${latest.verifyOk}.`,
        { dir: BACKUP_DIR, name: latest.name, finishedAt: latest.finishedAt },
      );
    }
  }
}

/**
 * درصد استفاده از دیسک مسیر داده — null یعنی پلتفرم/مسیر پشتیبانی نمی‌شود (هیچ هشداری ساخته نمی‌شود).
 * از `fs.statfs` استفاده می‌شود که بستگی جدیدی نمی‌خواهد.
 */
export async function diskUsagePercent(target: string): Promise<number | null> {
  try {
    const statfs = (fs as unknown as { statfs?: (p: string) => Promise<{ blocks: number; bavail: number; bsize: number }> }).statfs;
    if (!statfs) return null;
    const s = await statfs(target);
    if (!s || !Number.isFinite(s.blocks) || s.blocks <= 0) return null;
    return 1 - (s.bavail * s.bsize) / (s.blocks * s.bsize);
  } catch {
    return null;
  }
}
