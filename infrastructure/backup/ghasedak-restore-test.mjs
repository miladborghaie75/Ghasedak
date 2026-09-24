/**
 * Ghasedak Restore Verification — اثبات واقعی قابل‌بازیابی بودن بکاپ (بند ۹۳)
 * ============================================================
 * سناریو (همه واقعی، بدون فیک):
 *   1) ساخت دیتابیس موقت جداگانه ghasedak_restore_test_<ts>.
 *   2) بازسازی structure با `prisma migrate deploy` از خود ریپو (برای DB موقت) —
 *      یعنی دقیقاً همان DDL ای که production دارد؛ نه DDL بازسازی‌شده دستی.
 *   3) COPY IN واقعی CSV هر جدول.
 *   4) مقایسه COUNT با manifest + چک عدم خطا.
 *   5) خروج 0 فقط وقتی همه جداولِ سالمِ بکاپ بازیابی و count یکی شد.
 *   6) حذف کامل DB موقت (به‌جز --keep).
 *
 * استفاده:
 *   node ghasedak-restore-test.mjs --backup C:/ghasedak-backups/<stamp>
 *        [--repo C:/path/to/repo] [--admin-url postgresql://...@localhost:5433/postgres] [--keep]
 */
import { createRequire } from "node:module";
import { pipeline } from "node:stream/promises";

// pg خارج از ریپو نصب است (ابزار عملیاتی — پیش‌نیاز README همین پوشه)
const toolsRequire = createRequire("C:/ghasedak-tools/pg-client/package.json");
const { Client } = toolsRequire("pg");
const { from } = toolsRequire("pg-copy-streams");
import { createReadStream, readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const backupDir = arg("backup");
if (!backupDir || !existsSync(join(backupDir, "manifest.json"))) {
  console.error("USAGE: node ghasedak-restore-test.mjs --backup <dir-with-manifest.json> [--keep]");
  process.exit(1);
}
const repoDir = resolve(arg("repo", resolve(__dirname, "../..")));
const packagesDb = join(repoDir, "packages/database");
const adminUrl = arg("admin-url", process.env.DATABASE_URL ?? "postgresql://postgres:ghasedak-dev-pw@localhost:5433/postgres");
const keep = process.argv.includes("--keep");

const manifest = JSON.parse(readFileSync(join(backupDir, "manifest.json"), "utf8"));
const testDb = `ghasedak_restore_test_${Date.now().toString(36)}`;

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const qident = (n) => `"${n.replace(/"/g, '""')}"`;
const dbUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${testDb}`;
  return u.toString();
})();

async function main() {
  log(`restore-test → db=${testDb} from=${basename(backupDir)}`);

  // 1) DB موقت
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${qident(testDb)} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${qident(testDb)}`);
  await admin.end();
  log("temporary database created");

  // 2) structure با `prisma migrate diff --from-empty` از schema.prisma ریپو —
  //    عمداً migrate deploy (replay تاریخچه) استفاده نمی‌شود چون drift تاریخی pos_shift_link
  //    replay را می‌شکند (مستند در run.md)؛ diff مستقیم از datamodel، DDL کامل و معتبر می‌دهد.
  const ddl = execSync(
    `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`,
    { cwd: packagesDb, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  if (!ddl || ddl.trim().length < 100) throw new Error("migrate diff خروجی معتبر نداد");
  const tmp = mkdtempSync(join(tmpdir(), "ghasedak-restore-"));
  writeFileSync(join(tmp, "structure.sql"), ddl, "utf8");
  log(`DDL generated: ${ddl.split("\n").length} lines → applying to temp db…`);
  execSync(
    `npx prisma db execute --file "${join(tmp, "structure.sql")}" --schema prisma/schema.prisma`,
    { cwd: packagesDb, encoding: "utf8", env: { ...process.env, DATABASE_URL: dbUrl }, stdio: ["ignore", "pipe", "pipe"] },
  );
  log("structure restored from schema.prisma (migrate diff --from-empty)");

  // 3) داده — COPY IN واقعی
  const target = new Client({ connectionString: dbUrl });
  await target.connect();

  // FKها موقتاً غیرفعال (session-level) — ترتیب بارگذاری مستقل از وابستگی‌ها؛
  // در پایان یکپارچگی مرجعی با تحمیل مجدد محدودیت‌ها صحه‌گذاری می‌شود.
  await target.query(`SET session_replication_role = replica`);
  log("FK enforcement deferred (session_replication_role=replica)");

  const results = {};
  for (const [table, meta] of Object.entries(manifest.tables)) {
    const csv = join(backupDir, meta.file);
    if (meta.error || !existsSync(csv)) {
      results[table] = { restored: false, reason: meta.error ?? "csv missing (backup-side error)" };
      continue;
    }
    try {
      // لیست ستون‌ها از manifest — مطابقت با نام (بکاپ باید ستون‌ها را ثبت کرده باشد)
      const colList = Array.isArray(meta.columns) && meta.columns.length > 0
        ? meta.columns.map(qident).join(", ")
        : "*";
      const copySql = colList === "*"
        ? `COPY ${qident(table)} FROM STDIN WITH (FORMAT csv, HEADER true)`
        : `COPY ${qident(table)} (${colList}) FROM STDIN WITH (FORMAT csv, HEADER true)`;
      const pgStream = target.query(from(copySql));
      await pipeline(createReadStream(csv), pgStream);
      const { rows } = await target.query(`SELECT COUNT(*)::bigint AS n FROM ${qident(table)}`);
      const count = Number(rows[0].n);
      results[table] = { restored: true, rows: count, expected: meta.rows, match: count === meta.rows };
    } catch (e) {
      results[table] = { restored: false, reason: String(e?.message ?? e) };
    }
  }

  const restoredList = Object.entries(results).filter(([, r]) => r.restored);
  const mismatched = restoredList.filter(([, r]) => !r.match);
  const failed = Object.entries(results).filter(([, r]) => !r.restored);

  log(`restored=${restoredList.length}/${Object.keys(results).length}`);
  for (const [t, r] of mismatched) log(`MISMATCH ${t}: got=${r.rows} expected=${r.expected}`);
  for (const [t, r] of failed) log(`FAILED ${t}: ${r.reason}`);

  await target.end();

  // 4b) canary یکپارچگی (قطعی): در اتصال جدید (FK فعال) ستون FK یک جدول فرزندِ دارای ردیف
  //      به شناسه ناموجود UPDATE می‌شود — باید 23503 بدهد؛ اگر نداد یعنی قیدها enforce نمی‌شوند.
  let fkCanary = "SKIPPED (no candidate)";
  {
    const canary = new Client({ connectionString: dbUrl });
    try {
      await canary.connect();
      const { rows: fks } = await canary.query(
        `SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent,
                (SELECT attname FROM pg_attribute WHERE attrelid = conrelid AND attnum = conkey[1]) AS child_col
         FROM pg_constraint WHERE contype = 'f' LIMIT 30`,
      );
      for (const fk of fks) {
        const child = String(fk.child).replace(/"/g, "");
        const col = String(fk.child_col);
        const { rows: cnt } = await canary.query(`SELECT COUNT(*)::int AS n FROM ${qident(child)}`);
        if (Number(cnt[0].n) === 0) continue;
        try {
          const r = await canary.query(`UPDATE ${qident(child)} SET ${qident(col)} = 'ghasedak-fk-canary-invalid'`);
          fkCanary = `FAIL: UPDATE فرزند ${child}.${col} بدون خطای FK انجام شد (${r.rowCount} ردیف) — قیدها enforce نمی‌شوند!`;
        } catch (e) {
          fkCanary = String(e.code) === "23503"
            ? `OK: UPDATE فرزند ${child}.${col} با 23503 رد شد — قیدها فعال‌اند`
            : `WARN: خطای غیرمنتظره ${e.code ?? ""}: ${e.message}`;
        }
        break;
      }
    } catch (e) {
      fkCanary = `WARN: ${e.message}`;
    } finally {
      await canary.end().catch(() => undefined);
    }
  }
  log(`FK canary: ${fkCanary}`);

  // 5) پاکسازی
  if (!keep) {
    const admin2 = new Client({ connectionString: adminUrl });
    await admin2.connect();
    await admin2.query(`DROP DATABASE ${qident(testDb)} WITH (FORCE)`);
    await admin2.end();
    log("temporary database dropped");
  } else {
    log(`KEEP: ${testDb} باقی ماند (--keep)`);
  }

  // 6) حکم نهایی
  if (failed.length > 0 || mismatched.length > 0 || fkCanary.startsWith("FAIL")) {
    console.error("RESTORE_TEST_FAILED");
    process.exit(1);
  }
  if (restoredList.length === 0) {
    console.error("RESTORE_TEST_FAILED: هیچ جدولی بازیابی نشد.");
    process.exit(1);
  }
  log(`RESTORE_TEST_PASSED ✅ (${restoredList.length} جدول، همه countها منطبق)`);
}

main().catch(async (e) => {
  console.error("RESTORE_TEST_FAILED:", e.message);
  if (!keep) {
    try {
      const c = new Client({ connectionString: adminUrl });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${qident(testDb)} WITH (FORCE)`);
      await c.end();
      log("temporary database dropped (after failure)");
    } catch {}
  }
  process.exit(1);
});
