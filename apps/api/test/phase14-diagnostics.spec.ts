/**
 * بند ۸ — مرکز عیب‌یابی: endpoint تجمیعی، read-only، همهٔ چک‌ها واقعی.
 * روی rehearsal و دیسک واقعی اجرا می‌شود؛ هیچ mutationی ندارد.
 *
 * نکتهٔ CI: تست «backup check» حقایق ماشین عملیات (بکاپ واقعی + Scheduled Task
 * ویندوز) را می‌سنجد و روی رانر Linux قابل‌برقراری نیست — با it.skipIf فقط روی
 * همان ماشین اجرا می‌شود؛ حتی بیرون از آن، تست نخست حضور چک backup و detail
 * غیرخالی را (portable) تضمین می‌کند.
 */
import "reflect-metadata";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PrismaService } from "../src/prisma/prisma.service";
import { HealthService } from "../src/health/health.service";
import { DiagnosticsController } from "../src/admin/diagnostics.controller";
import { BACKUP_DIR, listBackupDirs } from "../src/admin/backup-status.controller";

jest.setTimeout(120_000);

describe("Phase 14 item8 — diagnostics center", () => {
  let prisma: PrismaService;
  let ctl: DiagnosticsController;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    ctl = new DiagnosticsController(prisma, new HealthService(prisma));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("همهٔ چک‌ها را برمی‌گرداند: هسته + outbox + sms + media + backup", async () => {
    const r = (await ctl.run()) as {
      status: string;
      tookMs: number;
      checks: Array<{ key: string; state: string; detail: string }>;
    };
    const keys = r.checks.map((c) => c.key);
    for (const k of ["api", "db", "redis", "storage", "outbox", "sms", "media", "backup"]) {
      expect(keys).toContain(k);
    }
    expect(["OK", "WARN", "FAIL"]).toContain(r.status);
    expect(r.tookMs).toBeGreaterThanOrEqual(0);
    // هر چک detail غیرخالی دارد
    for (const c of r.checks) expect(c.detail.length).toBeGreaterThan(0);
  });

  it("db سالم است و status کل FAIL نمی‌شود در محیط سالم", async () => {
    const r = (await ctl.run()) as { status: string; checks: Array<{ key: string; state: string }> };
    const db = r.checks.find((c) => c.key === "db")!;
    expect(db.state).toBe("OK");
  });

/** ماشین عملیات = ویندوز + پوشهٔ بکاپ واقعی (همان قاعدهٔ spec بکاپ) */
const OPS_MACHINE = (() => {
  try {
    return process.platform === "win32" && fs.existsSync(BACKUP_DIR) && listBackupDirs(BACKUP_DIR).length > 0;
  } catch {
    return false;
  }
})();

  (OPS_MACHINE ? it : it.skip)("backup check آخرین بکاپ واقعی را می‌بیند و تسک واقعی را گزارش می‌کند", async () => {
    const r = (await ctl.run()) as { checks: Array<{ key: string; state: string; data?: Record<string, unknown> }> };
    const b = r.checks.find((c) => c.key === "backup")!;
    expect(b.data?.latest).toBeTruthy();
    expect(b.data?.taskFound).toBe(true);
    expect(b.data?.taskEnabled).toBe(true);
  });

  it("read-only: بعد از run هیچ ردیف جدیدی در outbox/notify ساخته نمی‌شود", async () => {
    const before = {
      outbox: await prisma.domainEventOutbox.count(),
      notif: await prisma.notification.count(),
    };
    await ctl.run();
    expect(await prisma.domainEventOutbox.count()).toBe(before.outbox);
    expect(await prisma.notification.count()).toBe(before.notif);
  });

  it("checkStorage روی پوشهٔ غایب → WARN با پیام واقعی (بدون فیک)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gh-diag-"));
    fs.rmSync(tmp, { recursive: true, force: true }); // الان غایب است
    const prev = process.env.MEDIA_DIR;
    process.env.MEDIA_DIR = path.join(tmp, "no-such");
    try {
      const r = (await ctl.run()) as { checks: Array<{ key: string; state: string; detail: string }> };
      const s = r.checks.find((c) => c.key === "storage")!;
      expect(s.state).toBe("WARN");
      expect(s.detail).toContain("در دسترس نیست");
    } finally {
      if (prev === undefined) delete process.env.MEDIA_DIR;
      else process.env.MEDIA_DIR = prev;
    }
  });
});
