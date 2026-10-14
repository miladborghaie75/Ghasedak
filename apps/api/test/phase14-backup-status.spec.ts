/**
 * بند ۴ — وضعیت پشتیبان‌گیری: endpoint وضعیت از دیسک واقعی می‌خواند.
 * عمداً از C:/ghasedak-backups واقعی و تسک واقعی GhasedakDailyBackup استفاده می‌کند —
 * این همان اثبات عملیاتی است: فایل‌ها محصول ابزار رسمی بکاپ‌اند نه fixture ساختگی.
 * بدون فیک (بند ۱۱۱): مسیر خراب → available=false؛ تسک غایب → found=false.
 *
 * نکتهٔ CI: دو تستِ «دیسک واقعی» و «endpoint + تسک» حقایق همین ماشین عملیات را
 * می‌سنجند (بکاپ واقعی + Scheduled Task ویندوز) و روی رانر Linux قابل‌برقراری نیستند —
 * با it.skipIf روی ماشین عملیات اجرا و بیرون آن (CI) صریحاً skip می‌شوند؛ کدِ همان
 * مسیرها با fixtureهای موقت (بدون ماشین عملیات) پوشش داده شده است.
 */
import "reflect-metadata";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  BackupStatusController,
  BACKUP_DIR,
  listBackupDirs,
  readBackupDirInfo,
  maskDbUrl,
  computeRetention,
  readScheduledTask,
  normalizePsDate,
} from "../src/admin/backup-status.controller";
import { PrismaService } from "../src/prisma/prisma.service";

jest.setTimeout(60_000);

describe("Phase 14 item4 — backup status endpoint", () => {
  it("maskDbUrl پسورد را ماسک می‌کند و user را نگه می‌دارد", () => {
    expect(maskDbUrl("postgresql://postgres:secret-pw@127.0.0.1:55433/p11dev")).toBe(
      "postgresql://postgres:***@127.0.0.1:55433/p11dev",
    );
    expect(maskDbUrl("postgresql://postgres@127.0.0.1/db")).toBe("postgresql://postgres@127.0.0.1/db");
    expect(maskDbUrl(null)).toBeNull();
  });

  it("computeRetention تعداد نشان DELETED را می‌شمارد", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-bk-"));
    try {
      for (const n of ["a", "b", "c"]) fs.mkdirSync(path.join(root, n));
      fs.writeFileSync(path.join(root, "b", "DELETED"), "");
      const r = computeRetention(root, ["a", "b", "c"], 30);
      expect(r).toEqual({ keep: 30, active: 2, total: 3, deleted: 1 });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("readBackupDirInfo روی manifest خراب → null (بدون فیک)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-bk-"));
    try {
      fs.mkdirSync(path.join(root, "broken"));
      fs.writeFileSync(path.join(root, "broken", "manifest.json"), "{ not json");
      expect(readBackupDirInfo(root, "broken")).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

/** ماشین عملیات = ویندوز + پوشهٔ بکاپ واقعی با حداقل یک manifest؛ بیرون از آن تست‌های ops معنا ندارند */
const OPS_MACHINE = (() => {
  try {
    return process.platform === "win32" && fs.existsSync(BACKUP_DIR) && listBackupDirs(BACKUP_DIR).length > 0;
  } catch {
    return false;
  }
})();

describe("Phase 14 item4 — مسیرهای قابل‌حمل (fixture موقت، بدون ماشین عملیات)", () => {
  it("listBackupDirs فقط پوشه‌های دارای manifest را مرتب برمی‌گرداند", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-bk-list-"));
    try {
      fs.mkdirSync(path.join(root, "2026-10-01T00-00-00"));
      fs.writeFileSync(path.join(root, "2026-10-01T00-00-00", "manifest.json"), "{}");
      fs.mkdirSync(path.join(root, "2026-10-03T00-00-00"));
      fs.writeFileSync(path.join(root, "2026-10-03T00-00-00", "manifest.json"), "{}");
      fs.mkdirSync(path.join(root, "no-manifest"));
      fs.writeFileSync(path.join(root, "loose.txt"), "x");
      expect(listBackupDirs(root)).toEqual(["2026-10-01T00-00-00", "2026-10-03T00-00-00"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("manifest کامل → complete=true با summary واقعی و db ماسک‌شده؛ verify.json درست → verifyOk=true", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-bk-full-"));
    try {
      const dir = path.join(root, "2026-10-05T02-00-00");
      fs.mkdirSync(dir);
      fs.writeFileSync(
        path.join(dir, "manifest.json"),
        JSON.stringify({
          kind: "ghasedak-backup",
          version: 1,
          database: "postgresql://postgres:secret-pw@127.0.0.1:55433/ghasedak",
          startedAt: "2026-10-05T02:00:00.000Z",
          finishedAt: "2026-10-05T02:03:00.000Z",
          tables: { users: {}, orders: {} },
          summary: { tables: 2, tablesOk: 2, tablesFailed: 0, totalBytes: 1024, totalRows: 12 },
        }),
      );
      fs.writeFileSync(path.join(dir, "verify.json"), JSON.stringify({ ok: true, at: "2026-10-05T02:04:00.000Z" }));
      const info = readBackupDirInfo(root, "2026-10-05T02-00-00");
      expect(info).not.toBeNull();
      expect(info!.complete).toBe(true);
      expect(info!.summary!.tables).toBe(2);
      expect(info!.summary!.tablesFailed).toBe(0);
      expect(info!.summary!.totalRows).toBe(12);
      expect(info!.database).toContain("***");
      expect(info!.database).not.toContain("secret-pw");
      expect(info!.verifyOk).toBe(true);
      expect(info!.verifyAt).toBe("2026-10-05T02:04:00.000Z");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

  // ── اثبات عملیاتی ماشین واقعی (ویندوز + بکاپ واقعی + Scheduled Task) — روی CI صریحاً skip ──
  (OPS_MACHINE ? it : it.skip)("دیسک واقعی: تازه‌ترین بکاپ کامل است و summary واقعی دارد", () => {
    const names = listBackupDirs(BACKUP_DIR);
    expect(names.length).toBeGreaterThan(0);
    const latest = readBackupDirInfo(BACKUP_DIR, names[names.length - 1]);
    expect(latest).not.toBeNull();
    expect(latest!.complete).toBe(true);
    expect(latest!.summary!.tables).toBeGreaterThan(0);
    expect(latest!.summary!.tablesFailed).toBe(0);
    expect(latest!.database).toContain("***"); // credential ماسک شده
    expect(typeof latest!.verifyOk).toBe("boolean");
  });

  (OPS_MACHINE ? it : it.skip)("endpoint وضعیت: latest + history + تسک واقعی + retention", async () => {
    const prisma = new PrismaService(); // بدون $connect — endpoint به DB وابسته نیست
    const ctl = new BackupStatusController(prisma);
    const r = (await ctl.status()) as {
      available: boolean;
      latest: { complete: boolean; summary: { totalRows: number } } | null;
      history: unknown[];
      scheduledTask: { found: boolean; enabled: boolean; lastRun: string | null; lastResult: number | null };
      retention: { keep: number; active: number };
    };
    expect(r.available).toBe(true);
    expect(r.latest).not.toBeNull();
    expect(r.latest!.complete).toBe(true);
    expect(r.history.length).toBeGreaterThanOrEqual(1);
    expect(r.retention!.active).toBeGreaterThanOrEqual(1);
    // تسک زمان‌بند واقعی ویندوز — در این ماشین ثبت شده است
    expect(r.scheduledTask.found).toBe(true);
    expect(r.scheduledTask.enabled).toBe(true);
    expect(r.scheduledTask.lastRun).toBeTruthy();
    // lastResult بسته به وضعیت زیرساخت متغیر است (prod PG خاموش → 1)؛
    // فقط نوع و گزارش‌شدن چک می‌شود — وضعیت واقعی همان است که هست (بدون فیک)
    expect([0, 1, 267009]).toContain(r.scheduledTask.lastResult);
    await prisma.$disconnect().catch(() => undefined);
  });

  it("normalizePsDate کسر ۷ رقمی و فرمت دات‌نت را قابل new Date می‌کند", () => {
    const ps = "2026-09-30T02:00:01.1234567+03:30";
    const out = normalizePsDate(ps);
    expect(new Date(out!).getTime()).not.toBeNaN();
    const dotnet = normalizePsDate("/Date(1790721001000)/");
    expect(new Date(dotnet!).toISOString()).toBe(new Date(1790721001000).toISOString());
    expect(normalizePsDate(null)).toBeNull();
  });

  it("readScheduledTask روی تسک غایب → found=false (بدون فیک)", async () => {
    const r = await readScheduledTask("GhasedakNoSuchTask__");
    expect(r.found).toBe(false);
    expect(r.enabled).toBe(false);
  });
});
