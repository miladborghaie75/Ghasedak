import { Controller, Get } from "@nestjs/common";
import * as fs from "fs";
import { PrismaService } from "../prisma/prisma.service";
import { HealthService } from "../health/health.service";
import { RequirePermission } from "../auth/permissions.guard";
import { readBackupDirInfo, listBackupDirs, BACKUP_DIR, BACKUP_TASK_NAME } from "./backup-status.controller";
import { readScheduledTask } from "./backup-status.controller";
import { mediaDir } from "../common/media-dir";

/**
 * بند ۸ — مرکز عیب‌یابی: یک endpoint تجمیعی «وضعیت واقعی سیستم» برای اپراتور پنل.
 * هیچ چیز فیک نیست (بند ۱۱۱): هر چک واقعاً اجرا می‌شود و خطاها با پیام واقعی برمی‌گردند.
 * read-only — هیچ mutationی انجام نمی‌دهد.
 */

type State = "OK" | "WARN" | "FAIL" | "SKIP";
interface Check {
  key: string;
  label: string;
  state: State;
  detail: string;
  latencyMs?: number;
  data?: Record<string, unknown>;
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n)) return "?";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

@Controller("admin/diagnostics")
export class DiagnosticsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly health: HealthService,
  ) {}

  @Get()
  @RequirePermission("settings.view")
  async run() {
    const started = Date.now();
    const checks: Check[] = [];

    // ۱) هسته: api/db/redis/storage از HealthService واقعی
    const h = await this.health.getStatus();
    checks.push({ key: "api", label: "API", state: "OK", detail: `uptime ${h.uptimeSeconds}s` });
    checks.push({
      key: "db", label: "دیتابیس", state: h.checks.db ? "OK" : "FAIL",
      detail: h.checks.db ? "اتصال برقرار است" : "اتصال برقرار نیست",
    });
    checks.push({ key: "redis", label: "Redis", state: "SKIP", detail: "در این فاز استفاده نمی‌شود (Phase 17+)" });
    const storage = await this.checkStorage();
    checks.push(storage);

    // ۲) outbox — پس‌ماندهٔ PENDING/FAILED صف رویدادها
    checks.push(await this.checkOutbox());

    // ۳) SMS — اپراتور فعال + credential (بدون ارسال واقعی)
    checks.push(await this.checkSms());

    // ۴) پوشهٔ رسانه — دسترس‌پذیری و شمار فایل‌های یتیم محتمل (DB vs دیسک)
    checks.push(await this.checkMedia());

    // ۵) بکاپ — آخرین manifest + تسک زمان‌بند (بازاستفاده از همان منابع بند ۴)
    checks.push(await this.checkBackup());

    const fail = checks.some((c) => c.state === "FAIL");
    const warn = checks.some((c) => c.state === "WARN");
    return {
      status: fail ? "FAIL" : warn ? "WARN" : "OK",
      tookMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
      checks,
    };
  }

  private async timed<T>(fn: () => Promise<T>): Promise<{ r?: T; e?: unknown; ms: number }> {
    const t = Date.now();
    try {
      return { r: await fn(), ms: Date.now() - t };
    } catch (e) {
      return { e, ms: Date.now() - t };
    }
  }

  private async checkStorage(): Promise<Check> {
    const dir = mediaDir();
    const { r, e, ms } = await this.timed(async () => {
      const root = fs.existsSync(dir) ? dir : null;
      if (!root) return null;
      const files = fs.readdirSync(root).filter((f) => !f.startsWith("."));
      return { root, count: files.length };
    });
    if (e || !r) {
      return { key: "storage", label: "ذخیره‌سازی رسانه", state: "WARN", detail: `پوشه در دسترس نیست: ${dir}`, latencyMs: ms };
    }
    // شمار فایل‌های دیسک vs ردیف‌های DB — اختلاف = یتیم محتمل (ابزار media-orphans مرجع رفع است)
    let dbCount = -1;
    try {
      dbCount = await this.prisma.media.count();
    } catch { dbCount = -1; }
    const orphanish = dbCount >= 0 ? r.count - dbCount : null;
    return {
      key: "storage", label: "ذخیره‌سازی رسانه", state: "OK",
      detail: `${r.count} فایل در دیسک${dbCount >= 0 ? `، ${dbCount} ردیف در DB` : ""}${orphanish !== null && orphanish > 0 ? ` — ${orphanish} اختلاف (یتیم محتمل؛ ابزار media-orphans)` : ""}`,
      latencyMs: ms,
      data: { dir: r.root, diskFiles: r.count, dbRows: dbCount },
    };
  }

  private async checkOutbox(): Promise<Check> {
    const { r, e, ms } = await this.timed(async () => {
      const [pending, failed] = await Promise.all([
        this.prisma.domainEventOutbox.count({ where: { state: "PENDING" } }),
        this.prisma.domainEventOutbox.count({ where: { state: "FAILED" } }),
      ]);
      const failedNotifs = await this.prisma.notification.count({ where: { status: "FAILED" } });
      const queuedNotifs = await this.prisma.notification.count({ where: { status: "QUEUED" } });
      return { pending, failed, failedNotifs, queuedNotifs };
    });
    if (e) {
      return { key: "outbox", label: "صف رویدادها و اعلان‌ها", state: "FAIL", detail: `خواندن صف ناموفق: ${String(e)}`, latencyMs: ms };
    }
    const bad = r!.failed > 0 || r!.failedNotifs > 0;
    return {
      key: "outbox", label: "صف رویدادها و اعلان‌ها",
      state: bad ? "WARN" : "OK",
      detail: `outbox: ${r!.pending} در انتظار، ${r!.failed} ناموفق — اعلان: ${r!.queuedNotifs} در صف، ${r!.failedNotifs} ناموفق`,
      latencyMs: ms,
      data: r as Record<string, number>,
    };
  }

  private async checkSms(): Promise<Check> {
    const { r, e, ms } = await this.timed(async () => {
      const setting = await this.prisma.setting.findUnique({ where: { key: "sms" } });
      const cfg = (setting?.value ?? {}) as { provider?: string };
      return cfg.provider ?? "kavenegar";
    });
    if (e) {
      return { key: "sms", label: "پیامک", state: "WARN", detail: "خواندن تنظیمات ناموفق", latencyMs: ms };
    }
    const envKeys = ["KAVENEGAR_API_KEY", "GHASEDAKSMS_API_KEY", "MELIPAYAMAK_USERNAME", "MEDIANA_API_KEY", "IPPANEL_API_KEY", "SMSIR_API_KEY"];
    const configured = envKeys.filter((k) => !!process.env[k]);
    return {
      key: "sms", label: "پیامک",
      state: configured.length > 0 ? "OK" : "WARN",
      detail: `اپراتور فعال: ${r} — کلید پیکربندی‌شده: ${configured.length > 0 ? configured.join(", ") : "هیچ (تست/ارسال واقعی فقط QUEUED می‌ماند — بند ۱۱۱)"}`,
      latencyMs: ms,
      data: { activeProvider: r, configuredKeys: configured.length },
    };
  }

  private async checkMedia(): Promise<Check> {
    const { r, e, ms } = await this.timed(async () => {
      const total = await this.prisma.media.count();
      const byType = await this.prisma.media.groupBy({ by: ["mime"], _count: true });
      return { total, byType: Object.fromEntries(byType.map((b) => [b.mime, b._count])) };
    });
    if (e) {
      return { key: "media", label: "کتابخانهٔ رسانه", state: "WARN", detail: "خواندن ناموفق", latencyMs: ms };
    }
    return {
      key: "media", label: "کتابخانهٔ رسانه", state: "OK",
      detail: `${r!.total} ردیف — ${Object.keys(r!.byType).length} نوع`,
      latencyMs: ms, data: r as Record<string, unknown>,
    };
  }

  private async checkBackup(): Promise<Check> {
    const { r, e, ms } = await this.timed(async () => {
      let latest = null;
      try {
        const names = listBackupDirs(BACKUP_DIR);
        latest = names.length > 0 ? readBackupDirInfo(BACKUP_DIR, names[names.length - 1]) : null;
      } catch { latest = null; }
      const task = await readScheduledTask(BACKUP_TASK_NAME);
      return { latest, task };
    });
    if (e) {
      return { key: "backup", label: "پشتیبان‌گیری", state: "WARN", detail: "خواندن وضعیت ناموفق", latencyMs: ms };
    }
    const l = r!.latest;
    if (!l) {
      return { key: "backup", label: "پشتیبان‌گیری", state: "FAIL", detail: `هیچ بکاپی در ${BACKUP_DIR} یافت نشد`, latencyMs: ms };
    }
    const state: State = l.complete && r!.task.found ? "OK" : "WARN";
    return {
      key: "backup", label: "پشتیبان‌گیری", state,
      detail: `آخرین: ${l.name} (${l.complete ? "کامل" : "ناقص"}${l.verifyOk ? "، تأییدشده" : ""}) — تسک: ${r!.task.found ? (r!.task.enabled ? "فعال" : "غیرفعال") : "یافت نشد"}`,
      latencyMs: ms,
      data: { latest: l.name, complete: l.complete, verified: l.verifyOk, taskFound: r!.task.found, taskEnabled: r!.task.enabled },
    };
  }
}
