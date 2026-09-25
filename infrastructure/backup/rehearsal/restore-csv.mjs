/**
 * restore-csv.mjs — Step 7 بازیابی: COPY همهٔ CSVهای بکاپ به DB rehearsal.
 * فقط به 55432/ghasedak_recovery_rehearsal وصل می‌شود؛ primary هرگز آدرس نمی‌شود.
 */
import { createRequire } from "node:module";
import { pipeline } from "node:stream/promises";
import { createReadStream, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { assertSafeUrl } from "./_safety.mjs";

const toolsRequire = createRequire("C:/ghasedak-tools/pg-client/package.json");
const { Client } = toolsRequire("pg");
const { from } = toolsRequire("pg-copy-streams");

const REHEARSAL_URL = assertSafeUrl(
  process.env.REHEARSAL_URL ?? "postgresql://postgres:rehearsal-pw@127.0.0.1:55432/ghasedak_recovery_rehearsal",
  { label: "restore-csv" },
);
const backupDir = "C:/ghasedak-backups/2026-09-24T21-37-14";

const qident = (n) => `"${n.replace(/"/g, '""')}"`;
const manifest = JSON.parse(readFileSync(join(backupDir, "manifest.json"), "utf8"));

const target = new Client({ connectionString: REHEARSAL_URL });
await target.connect();

// FKها در زمان لود خاموش (session-level)؛ در اسکریپت اعتبارسنجی بعدی دوباره enforce و سنجیده می‌شوند.
await target.query("SET session_replication_role = replica");

const results = {};
let totalRows = 0, ok = 0, failed = 0;
for (const [table, meta] of Object.entries(manifest.tables)) {
  const csv = join(backupDir, meta.file);
  if (meta.error || !existsSync(csv)) {
    results[table] = { restored: false, reason: meta.error ?? "csv missing" };
    failed++;
    continue;
  }
  try {
    const colList = Array.isArray(meta.columns) && meta.columns.length > 0
      ? meta.columns.map(qident).join(", ")
      : "*";
    const copySql = colList === "*"
      ? `COPY ${qident(table)} FROM STDIN WITH (FORMAT csv, HEADER true)`
      : `COPY ${qident(table)} (${colList}) FROM STDIN WITH (FORMAT csv, HEADER true)`;
    await pipeline(createReadStream(csv), target.query(from(copySql)));
    const { rows } = await target.query(`SELECT COUNT(*)::bigint AS n FROM ${qident(table)}`);
    const count = Number(rows[0].n);
    totalRows += count;
    if (count === meta.rows) { ok++; results[table] = { rows: count, ok: true }; }
    else { failed++; results[table] = { rows: count, expected: meta.rows, ok: false }; }
  } catch (e) {
    failed++;
    results[table] = { restored: false, reason: String(e?.message ?? e) };
  }
}

await target.query("SET session_replication_role = DEFAULT");
await target.end();

console.log(`tables ok=${ok}/${Object.keys(manifest.tables).length}  totalRows=${totalRows}  failed=${failed}`);
for (const [t, r] of Object.entries(results)) if (!r.ok) console.log("PROBLEM", t, JSON.stringify(r));
console.log(totalRows === 652 && failed === 0 ? "RESTORE_CSV_PASSED" : "RESTORE_CSV_FAILED");
process.exit(totalRows === 652 && failed === 0 ? 0 : 1);
