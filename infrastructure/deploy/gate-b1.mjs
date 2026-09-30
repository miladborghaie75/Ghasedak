#!/usr/bin/env node
/**
 * gate-b1.mjs — اتوماسیون پروتکل B1 استقرار Ghasedak (deploy بدون migration)
 * ============================================================================
 * همان پروتکلی که دستی برای فاز ۱۲ روی prod اجرا شد، حالا یک دستور:
 *
 *   فاز pre  (قبل از استارت سرویس‌ها با HEAD):
 *     ۱) baseline فقط-خواندنی — شمارش جدول‌های کلیدی + Dr/Cr + مایگریشن‌ها
 *     ۲) بکاپ کامل با ابزار رسمی + verify (BACKUP_VERIFY_PASSED)
 *     ۳) prisma migrate diff (schema prod در برابر HEAD) — باید «No difference detected»
 *        (مگر --expect-migration، که در آن حالت diff غیرصفر قابل قبول است و فقط ثبت می‌شود)
 *
 *   فاز post (بعد از deploy کد؛ فقط-خواندنی):
 *     ۴) smoke گیت‌دار — GHASEDAK_WORKERS=off، تایمر EventBus/Dispatcher/Reminder = null
 *     ۵) مقایسهٔ residue با baseline — همهٔ شمارش‌ها باید unchanged باشند
 *     ۶) بکاپ post + verify
 *     ۷) گزارش نهایی — GATE_B1 = GREEN | RED
 *
 * قوانین سخت (بدون استثنا):
 *   - هیچ نوشتنی روی داده در خود گیت (فقط SELECT)؛ بکاپ ابزار رسمی خودش می‌خواند.
 *   - هر شکست = STOP فوری و خروجی RED با شمارهٔ گام.
 *
 * استفاده:
 *   node gate-b1.mjs pre  --url "postgresql://...@127.0.0.1:5433/ghasedak" [--out C:/ghasedak-backups]
 *   node gate-b1.mjs post --url "postgresql://...@127.0.0.1:5433/ghasedak" [--out C:/ghasedak-backups]
 *                              [--state C:/ghasedak-backups/.gate-b1-state.json]
 *   node gate-b1.mjs all  ...            # هر دو فاز پشت سر هم
 *
 * خروجی فاز pre: state JSON (baseline + مسیر بکاپ + نتیجهٔ diff) برای مصرف فاز post.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../../.."); // infrastructure/deploy -> root
const require2 = createRequire("C:/ghasedak-tools/pg-client/package.json");
const { Client } = require2("pg");

// ---------- args ----------
function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const phase = process.argv[2] ?? "all";
const url = arg("url", process.env.DATABASE_URL ?? "postgresql://postgres:ghasedak-dev-pw@127.0.0.1:5433/ghasedak");
const outRoot = arg("out", "C:/ghasedak-backups");
const statePath = arg("state", join(outRoot, ".gate-b1-state.json"));
const expectMigration = process.argv.includes("--expect-migration");

let step = 0;
const failed = [];
function ok(msg) { console.log(`  OK  ${msg}`); }
function bad(msg) { console.log(`  XX  ${msg}`); failed.push(msg); }
function head(title) { step++; console.log(`\n== STEP ${step}: ${title} ==`); }

async function withClient(fn) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const scalar = (c, sql) => c.query(sql).then((r) => Object.values(r.rows[0] ?? { v: null })[0]);

async function baselineCounts(c) {
  const tables = [
    "JournalLine", "JournalEntry", "BankStatement", "PaymentAttempt", "AuditLog",
    "AdminSession", "Order", "PosInvoice", "PosTicket", "Notification",
    "Check", "PurchaseInvoice", "Refund", "Media", "StockAlert",
  ];
  const counts = {};
  for (const t of tables) {
    counts[t] = Number(await scalar(c, `select count(*) as v from "${t}"`));
  }
  counts._migrations = Number(await scalar(c, `select count(*) as v from "_prisma_migrations"`));
  counts._migrations_applied = Number(await scalar(c, `select count(*) as v from "_prisma_migrations" where finished_at is not null and rolled_back_at is null`));
  counts._dr = (await scalar(c, `select coalesce(sum(debit),0) as v from "JournalLine"`)).toString();
  counts._cr = (await scalar(c, `select coalesce(sum(credit),0) as v from "JournalLine"`)).toString();
  counts._outbox_failed = Number(await scalar(c, `select count(*) as v from "DomainEventOutbox" where state='FAILED'`));
  counts._outbox_pending = Number(await scalar(c, `select count(*) as v from "DomainEventOutbox" where state='PENDING'`));
  counts._outbox_dispatched = Number(await scalar(c, `select count(*) as v from "DomainEventOutbox" where state='DISPATCHED'`));
  return counts;
}

function latestBackupDir() {
  const { readdirSync, statSync } = require2("fs");
  const dirs = readdirSync(outRoot)
    .filter((d) => /^\d{4}-\d{2}-\d{2}T/.test(d))
    .map((d) => join(outRoot, d))
    .filter((d) => statSync(d).isDirectory() && existsSync(join(d, "manifest.json")))
    .sort();
  return dirs.at(-1);
}

/** smoke داخلی value-agnostic — بوت service-level با گیت workers=off؛ تایمرها باید null بمانند */
async function smokeGate(databaseUrl) {
  const { pathToFileURL } = await import("node:url");
  const dist = join(ROOT, "apps/api/dist");
  const u = (p) => pathToFileURL(`${dist}/${p}`).href;
  process.env.DATABASE_URL = databaseUrl;
  process.env.GHASEDAK_WORKERS = "off";
  const { PrismaService } = await import(u("prisma/prisma.service.js"));
  const { EventBusService } = await import(u("events/event-bus.service.js"));
  const { NotificationDispatcherService } = await import(u("events/notification-dispatcher.service.js"));
  const { ReminderService } = await import(u("checks/reminder.service.js"));
  const prisma = new PrismaService();
  await prisma.$connect();
  const bus = new EventBusService(prisma); bus.onModuleInit();
  const disp = new NotificationDispatcherService(prisma); disp.onModuleInit();
  const rem = new ReminderService(prisma); rem.onModuleInit();
  const gatesOk = bus.timer === null && disp.timer === null && rem.timer === null;
  const invoiceCount = await prisma.posInvoice.count();
  const outboxFailed = await prisma.domainEventOutbox.count({ where: { state: "FAILED" } });
  await prisma.$disconnect();
  bus.onModuleDestroy(); disp.onModuleDestroy(); rem.onModuleDestroy();
  if (!gatesOk) throw new Error("workers gate شکسته است — تایمر با off استارت شده");
  return { gatesOk, invoiceCount, outboxFailed };
}

// ============================================================ فاز pre
async function phasePre() {
  console.log(`GATE B1 — PHASE PRE\nurl: ${url}\n`);

  head("Baseline (read-only)");
  let before;
  await withClient(async (c) => { before = await baselineCounts(c); });
  console.log(JSON.stringify(before, null, 2));
  if (before._dr !== before._cr) bad(`دفتر تراز نیست: Dr=${before._dr} Cr=${before._cr}`);
  else ok(`دفتر تراز است — Dr=Cr=${before._dr}`);

  head("Backup (official tool) + verify");
  execFileSync(process.execPath, [join(ROOT, "infrastructure/backup/ghasedak-backup.mjs"), "--url", url, "--out", outRoot], { stdio: "inherit" });
  const bdir = latestBackupDir();
  if (!bdir) { bad("بکاپ پیدا نشد"); throw new Error("no backup"); }
  console.log(`backup: ${bdir}`);
  execFileSync(process.execPath, [join(ROOT, "infrastructure/backup/rehearsal/verify-backup.mjs"), bdir], { stdio: "inherit" });
  const manifest = JSON.parse(readFileSync(join(bdir, "manifest.json"), "utf8"));
  const summary = manifest.summary ?? {};
  ok(`backup verified: tables=${summary.tables} rows=${summary.totalRows}`);

  head("Schema diff (prod vs HEAD)");
  const diff = execFileSync(
    process.execPath,
    [
      join(ROOT, "packages/database/node_modules/prisma/build/index.js"),
      "migrate", "diff", "--from-url", url,
      "--to-schema-datamodel", join(ROOT, "packages/database/prisma/schema.prisma"),
      "--exit-code",
    ],
    { encoding: "utf8", cwd: join(ROOT, "packages/database") },
  );
  const noDiff = /no difference/i.test(diff);
  if (noDiff) ok("No difference detected");
  else if (expectMigration) ok("diff غیرصفر — انتظار migration ثبت شد");
  else { bad("schema prod با HEAD فرق دارد — migration اجرا نشده؟\n" + diff.slice(0, 2000)); }

  writeFileSync(statePath, JSON.stringify({ url, before, backupDir: bdir, manifestSha: manifest.manifestSha256 ?? null, diffNoChange: noDiff, at: new Date().toISOString() }, null, 2));
  console.log(`\nstate: ${statePath}`);
  if (failed.length) { console.log(`\nPHASE_PRE = RED (${failed.length} issue)`); process.exit(1); }
  console.log("\nPHASE_PRE = GREEN");
}

// ============================================================ فاز post
async function phasePost() {
  console.log(`GATE B1 — PHASE POST\nurl: ${url}\n`);
  if (!existsSync(statePath)) { console.error("state فاز pre پیدا نشد — اول pre را اجرا کن"); process.exit(1); }
  const st = JSON.parse(readFileSync(statePath, "utf8"));
  const before = st.before;

  head("Read-only smoke (workers gate)");
  const smoke = await smokeGate(url);
  ok(`gates=null ✓ posInvoice=${smoke.invoiceCount} outboxFailed=${smoke.outboxFailed}`);

  head("Residue compare (before vs after)");
  let after;
  await withClient(async (c) => { after = await baselineCounts(c); });
  const stableKeys = ["_migrations", "_migrations_applied", "_dr", "_cr",
    ...Object.keys(before).filter((k) => !k.startsWith("_") && !["AdminSession"].includes(k))];
  let match = true;
  for (const k of stableKeys) {
    const a = String(after[k]), b = String(before[k]);
    const line = `${k}: ${b} -> ${a}`;
    if (a !== b) { bad(line); match = false; } else ok(line);
  }
  ok(`AdminSession (تغییر طبیعی سشن): ${before.AdminSession} -> ${after.AdminSession}`);
  if (after._dr !== after._cr) bad("تراز بعد از deploy بهم خورده");

  head("Post-deploy backup + verify");
  execFileSync(process.execPath, [join(ROOT, "infrastructure/backup/ghasedak-backup.mjs"), "--url", url, "--out", outRoot], { stdio: "inherit" });
  const bdir2 = latestBackupDir();
  execFileSync(process.execPath, [join(ROOT, "infrastructure/backup/rehearsal/verify-backup.mjs"), bdir2], { stdio: "inherit" });
  ok(`post backup: ${bdir2}`);

  head("Final report");
  console.log(JSON.stringify({ pre: before, post: after, residueMatch: match, preBackup: st.backupDir, postBackup: bdir2 }, null, 2));
  if (failed.length) { console.log(`\nGATE_B1 = RED (${failed.length} issue)`); process.exit(1); }
  console.log("\nGATE_B1 = GREEN");
}

try {
  if (phase === "pre") await phasePre();
  else if (phase === "post") await phasePost();
  else if (phase === "all") { await phasePre(); await phasePost(); }
  else { console.error("استفاده: node gate-b1.mjs {pre|post|all} --url ..."); process.exit(2); }
} catch (e) {
  console.error("\nGATE_B1 = RED — خطای غیرمنتظره:");
  console.error(e?.message ?? e);
  process.exit(1);
}
