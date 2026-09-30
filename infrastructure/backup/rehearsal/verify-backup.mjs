/**
 * verify-backup.mjs — verify کامل بکاپ (PHASE 3) — فقط-خواندنی، هیچ اتصالی به DB.
 *  1) manifestSha256 = sha256(JSON.stringify(manifest بدون فیلد خودش, null, 2))
 *  2) برای هر table: sha256 فایل CSV + bytes + rows
 * usage: node verify-backup.mjs <backupDir>
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir || !existsSync(join(dir, "manifest.json"))) {
  console.error("usage: node verify-backup.mjs <backupDir-with-manifest.json>");
  process.exit(2);
}

const raw = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const stored = raw.manifestSha256;
const { manifestSha256, ...rest } = raw;
const recomputed = createHash("sha256").update(JSON.stringify(rest, null, 2)).digest("hex");
const manifestOk = stored === recomputed;

console.log(`manifest.meta: url=${raw.source?.url ?? raw.url ?? "?"} tables=${Object.keys(raw.tables ?? {}).length} totalRows=${raw.totalRows ?? raw.rows ?? "?"}`);
console.log(`manifestSha256: ${manifestOk ? "VALID" : "INVALID"} (${stored})`);

let ok = 0, bad = 0, totalRows = 0;
const problems = [];
for (const [table, meta] of Object.entries(raw.tables ?? {})) {
  if (meta.error) { bad++; problems.push(`${table}: manifest error ${meta.error}`); continue; }
  const csv = join(dir, meta.file);
  let fileOk = false, sizeOk = false, hashOk = false, bytes = -1;
  try {
    if (existsSync(csv)) {
      const buf = readFileSync(csv);
      bytes = buf.length;
      sizeOk = bytes === meta.bytes;
      hashOk = createHash("sha256").update(buf).digest("hex") === meta.sha256;
      fileOk = sizeOk && hashOk;
    }
  } catch (e) {
    problems.push(`${table}: read error ${e.message}`);
  }
  totalRows += meta.rows ?? 0;
  if (fileOk) ok++;
  else { bad++; problems.push(`${table}: file=${fileOk} size=${sizeOk}(${bytes} vs ${meta.bytes}) hash=${hashOk}`); }
}

console.log(`files: ${ok}/${Object.keys(raw.tables ?? {}).length} OK, bad=${bad}`);
console.log(`rows (manifest): ${totalRows}`);
if (problems.length) console.log(`PROBLEMS:\n- ` + problems.join("\n- "));
const verdict = manifestOk && bad === 0;
console.log(verdict ? "BACKUP_VERIFY_PASSED" : "BACKUP_VERIFY_FAILED");

// امضای نتیجه کنار manifest — منبعِ نشان «تأییدشده» در endpoint وضعیت و پنل ادمین (بند ۴)
try {
  writeFileSync(
    join(dir, "verify.json"),
    JSON.stringify({
      ok: verdict,
      at: new Date().toISOString(),
      files: `${ok}/${Object.keys(raw.tables ?? {}).length}`,
      rows: totalRows,
      manifestSha256Valid: manifestOk,
      tool: "verify-backup.mjs v2",
    }, null, 2),
  );
} catch (e) {
  console.error(`verify.json write skipped: ${e.message}`);
}
process.exit(verdict ? 0 : 1);
