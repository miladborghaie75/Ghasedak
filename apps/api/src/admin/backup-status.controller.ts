import { Controller, Get } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { PrismaService } from "../prisma/prisma.service";
import { RequirePermission } from "../auth/permissions.guard";

/**
 * وضعیت پشتیبان‌گیری (بند ۴ — نیمهٔ مانده): بکاپ رسمی، فایل‌محور با manifest است.
 * API هرگز بکاپ نمی‌گیرد و بازیابی نمی‌کند؛ فقط «وضعیت واقعی» را از دیسک می‌خواند
 * (بدون فیک — بند ۱۱۱): تازه‌ترین manifest پوشهٔ بکاپ + تسک ویندوزی + retention.
 * credential در URL دیتابیس همیشه ماسک می‌شود (بند ۴۵).
 */

interface ManifestSummary {
  tables: number; tablesOk: number; tablesFailed: number; totalBytes: number; totalRows: number;
}
interface Manifest {
  kind?: string; version?: number; database?: string;
  startedAt?: string; finishedAt?: string;
  tables?: Record<string, unknown>; summary?: ManifestSummary;
}

/** ماسک پسورد در URL دیتابیس — هیچ مقدار محرمانه‌ای کامل برنمی‌گردد (بند ۴۵) */
export function maskDbUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  return url.replace(/:\/\/([^:@/]+):([^@]*)@/, "://$1:***@");
}

export interface BackupDirInfo {
  dir: string;
  name: string;
  startedAt: string | null;
  finishedAt: string | null;
  database: string | null;
  summary: ManifestSummary | null;
  complete: boolean;
  verifyOk: boolean;
  verifyAt: string | null;
}

/** فهرست مرتب‌شدهٔ پوشه‌های بکاپ که manifest.json دارند (قدیم→جدید) */
export function listBackupDirs(root: string): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => fs.existsSync(path.join(root, n, "manifest.json")))
    .sort();
}

/** خواندن امن یک پوشهٔ بکاپ؛ manifest خراب/ناقص → null (بدون فیک) */
export function readBackupDirInfo(root: string, name: string): BackupDirInfo | null {
  try {
    const dir = path.join(root, name);
    const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as Manifest;
    if (!m || typeof m !== "object") return null;
    const summary = m.summary ?? null;
    const complete = !!summary && summary.tablesFailed === 0 && summary.tablesOk === summary.tables && typeof m.startedAt === "string";
    let verifyOk = false;
    let verifyAt: string | null = null;
    try {
      const v = JSON.parse(fs.readFileSync(path.join(dir, "verify.json"), "utf8")) as { ok?: unknown; at?: unknown };
      verifyOk = v.ok === true;
      verifyAt = typeof v.at === "string" ? v.at : null;
    } catch {
      /* verify.json غایب/خراب → verifyOk=false (واقعیتِ دیسک) */
    }
    return {
      dir, name,
      startedAt: m.startedAt ?? null,
      finishedAt: m.finishedAt ?? null,
      database: maskDbUrl(m.database),
      summary,
      complete, verifyOk, verifyAt,
    };
  } catch {
    return null;
  }
}

/** retention: «فعال» = پوشه‌هایی که نشان DELETED ندارند؛ خودِ ابزار بکاپ حذف می‌کند، اینجا فقط شمارش */
export function computeRetention(root: string, names: string[], keep: number): { keep: number; active: number; total: number; deleted: number } {
  let deleted = 0;
  for (const n of names) {
    try { if (fs.existsSync(path.join(root, n, "DELETED"))) deleted++; } catch { /* ignore */ }
  }
  return { keep, active: names.length - deleted, total: names.length, deleted };
}

// ============================ کنترلر ============================

export const BACKUP_DIR = process.env.GHASEDAK_BACKUP_DIR ?? "C:/ghasedak-backups";
export const BACKUP_TASK_NAME = "GhasedakDailyBackup";
export const BACKUP_RETENTION_KEEP = Number(process.env.GHASEDAK_BACKUP_KEEP ?? 30);

export interface ScheduledTaskInfo {
  name: string;
  found: boolean;
  enabled: boolean;
  lastRun: string | null;
  lastResult: number | null;
  nextRun: string | null;
}

/** نرمال‌سازی تاریخ PowerShell: /Date(ms)/ دات‌نت یا کسر ۷ رقمی → ISO قابل new Date */
export function normalizePsDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const dotnet = /^\/Date\((\d+)\)\/$/.exec(s.trim());
  if (dotnet) return new Date(Number(dotnet[1])).toISOString();
  return s.replace(/\.(\d{3})\d+/, ".1$1");
}

/** خواندن تسک زمان‌بند ویندوزی با PowerShell — هر خطا/عدم‌دسترس → found=false (بدون فیک) */
export async function readScheduledTask(name: string): Promise<ScheduledTaskInfo> {
  const fallback: ScheduledTaskInfo = { name, found: false, enabled: false, lastRun: null, lastResult: null, nextRun: null };
  if (process.platform !== "win32") return fallback;
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    try {
      const ps = `$t = Get-ScheduledTask -TaskName "${name}" -ErrorAction Stop; $t | Get-ScheduledTaskInfo | Select-Object LastRunTime,LastTaskResult,NextRunTime | ConvertTo-Json -Compress; $t.State`;
      const p = spawn("powershell", ["-NoProfile", "-Command", ps], { windowsHide: true });
      let out = "";
      const t = setTimeout(() => { try { p.kill(); } catch { /* noop */ } resolve(fallback); }, 5000);
      p.on("error", () => { clearTimeout(t); resolve(fallback); });
      p.stdout.on("data", (d) => (out += String(d)));
      p.on("close", () => {
        clearTimeout(t);
        const lines = out.trim().split(/\r?\n/).filter(Boolean);
        if (lines.length < 2) return resolve(fallback);
        try {
          const raw = JSON.parse(lines[0]) as { LastRunTime?: string | null; LastTaskResult?: number; NextRunTime?: string | null };
          const info = Array.isArray(raw) ? raw[0] : raw;
          const state = String(lines[lines.length - 1] ?? "").trim();
          resolve({
            name,
            found: true,
            enabled: state === "Ready" || state === "Running",
            lastRun: normalizePsDate(info.LastRunTime),
            lastResult: typeof info.LastTaskResult === "number" ? info.LastTaskResult : null,
            nextRun: normalizePsDate(info.NextRunTime),
          });
        } catch {
          resolve(fallback);
        }
      });
    } catch {
      resolve(fallback);
    }
  });
}

@Controller("admin/backup")
export class BackupStatusController {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /admin/backup/status — وضعیت واقعی آخرین بکاپ + تسک زمان‌بند + retention */
  @Get("status")
  @RequirePermission("settings.view")
  async status() {
    let rootReadable = true;
    let names: string[] = [];
    try {
      names = listBackupDirs(BACKUP_DIR);
    } catch {
      rootReadable = false;
    }
    const latest = rootReadable && names.length > 0 ? readBackupDirInfo(BACKUP_DIR, names[names.length - 1]) : null;
    const history = rootReadable
      ? names.slice(-6).map((n) => readBackupDirInfo(BACKUP_DIR, n)).filter((x): x is BackupDirInfo => x !== null)
      : [];
    const task = await readScheduledTask(BACKUP_TASK_NAME);
    return {
      available: rootReadable,
      backupDir: BACKUP_DIR,
      latest,
      history,
      scheduledTask: task,
      retention: rootReadable ? computeRetention(BACKUP_DIR, names, BACKUP_RETENTION_KEEP) : null,
    };
  }
}
