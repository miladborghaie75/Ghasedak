/**
 * Ghasedak Real Logical Backup — بند ۹۳ Master (Backup/DR)
 * ============================================================
 * واقعی بودن (قاعده No Fake Completion):
 *  1) داده هر جدول با SQL واقعی `COPY (SELECT * FROM "T") TO STDOUT WITH (FORMAT csv, HEADER)`
 *     از سرور گرفته می‌شود — همان مسیری که pg_dump داده را می‌خواند؛ بایت‌به‌بایت از wire.
 *  2) برای هر جدول: COUNT واقعی + بایت + sha256 ثبت می‌شود (بعداً در restore-test مقایسه می‌شود).
 *  3) ساختار جدول‌ها از migrationهای خود ریپو بازسازی می‌شود (ghasedak-restore-test.mjs با
 *     `prisma migrate deploy` روی DB موقت) — یعنی بکاپ + تاریخچه migration = بازیابی کامل.
 *  4) خروجی: <out>/<stamp>/ — data/<Table>.csv + manifest.json + backup.log
 *
 * استفاده:
 *   node ghasedak-backup.mjs [--url postgresql://...@localhost:5433/ghasedak]
 *                            [--out C:/ghasedak-backups] [--table "User" --table "Order"]
 */
import { createRequire } from "node:module";
import { pipeline } from "node:stream/promises";

// pg خارج از ریپو نصب است (ابزار عملیاتی — پیش‌نیاز README همین پوشه)
const toolsRequire = createRequire("C:/ghasedak-tools/pg-client/package.json");
const { Client } = toolsRequire("pg");
const { to } = toolsRequire("pg-copy-streams"); // COPY TO STDOUT
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const DEFAULT_URL = process.env.DATABASE_URL ?? "postgresql://postgres:ghasedak-dev-pw@localhost:5433/ghasedak";
const connectionString = arg("url", DEFAULT_URL);
const outRoot = arg("out", "C:/ghasedak-backups");
const onlyTables = process.argv.filter((a, i) => process.argv[i - 1] === "--table");

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = join(outRoot, stamp);
const dataDir = join(dir, "data");
mkdirSync(dataDir, { recursive: true });

const logPath = join(dir, "backup.log");
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  appendFileSync(logPath, line + "\n");
  console.log(line);
}

const qident = (name) => `"${name.replace(/"/g, '""')}"`;

async function main() {
  log(`backup start → ${dir}`);
  const client = new Client({ connectionString });
  await client.connect();
  log("connected");

  const { rows: tables } = await client.query(
    `SELECT tablename AS name FROM pg_tables
     WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%'
     ORDER BY tablename`,
  ); // _prisma_migrations کتاب‌داری خود Prisma است، نه داده کسب‌وکار — structure از schema.prisma می‌آید
  const names = onlyTables.length ? onlyTables : tables.map((t) => t.name);
  log(`tables: ${names.length}`);

  const manifest = {
    kind: "ghasedak-logical-backup",
    version: 1,
    database: connectionString.replace(/:[^:@/]*@/, ":***@"),
    startedAt: new Date().toISOString(),
    tables: {},
    tablesOrder: names,
    /** ساختار از migrationهای ریپو بازسازی می‌شود — نه از DDL استخراجی */
    structureSource: "prisma-migrations",
  };

  let okCount = 0;
  for (const name of names) {
    const file = join(dataDir, `${name}.csv`);
    try {
      // لیست صریح ستون‌ها — COPY موقعیتی است؛ ترتیب فیزیکی DB زنده (migrationهای قدیمی)
      // ممکن است با DDL تازه (schema فعلی) فرق داشته باشد. مطابقت با نام، مقاوم به drift است.
      const { rows: cols } = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
        [name],
      );
      const columns = cols.map((c) => c.column_name);
      const colList = columns.map(qident).join(", ");

      const { rows } = await client.query(`SELECT COUNT(*)::bigint AS n FROM ${qident(name)}`);
      const count = Number(rows[0].n);

      const hash = createHash("sha256");
      let bytes = 0;
      const copySql = `COPY ${qident(name)} (${colList}) TO STDOUT WITH (FORMAT csv, HEADER true)`;
      const pgStream = client.query(to(copySql));
      const out = createWriteStream(file);
      pgStream.on("data", (chunk) => {
        hash.update(chunk);
        bytes += chunk.length;
      });
      await pipeline(pgStream, out);

      manifest.tables[name] = { file: `data/${name}.csv`, rows: count, bytes, sha256: hash.digest("hex"), columns };
      okCount += 1;
      log(`ok ${name}: rows=${count} bytes=${bytes}`);
    } catch (e) {
      manifest.tables[name] = { file: `data/${name}.csv`, error: String(e?.message ?? e) };
      log(`ERROR ${name}: ${e.message}`);
    }
  }

  await client.end();

  manifest.finishedAt = new Date().toISOString();
  manifest.summary = {
    tables: names.length,
    tablesOk: okCount,
    tablesFailed: names.length - okCount,
    totalBytes: Object.values(manifest.tables).reduce((s, t) => s + (t.bytes ?? 0), 0),
    totalRows: Object.values(manifest.tables).reduce((s, t) => s + (t.rows ?? 0), 0),
  };
  manifest.manifestSha256 = createHash("sha256").update(JSON.stringify(manifest, null, 2)).digest("hex");
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  log(`done: ok=${okCount}/${names.length} rows=${manifest.summary.totalRows}`);
  if (okCount === 0) {
    console.error("BACKUP_FAILED: هیچ جدولی بکاپ نشد.");
    process.exit(1);
  }
  if (okCount < names.length) {
    console.warn(`BACKUP_PARTIAL: ${names.length - okCount} جدول خطا داشت — manifest را ببین.`);
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error("BACKUP_FAILED:", e.message);
  process.exit(1);
});
