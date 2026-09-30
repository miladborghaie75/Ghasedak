#!/usr/bin/env node
/**
 * media-orphans.mjs — فایل‌های بی‌صاحب رسانه (ابزار عملیاتی — بند ۵۹ بدون duplicate)
 *
 * فایل‌های داخل MEDIA_DIR که ردیفی در جدول Media ندارند را فهرست می‌کند.
 * حالت‌ها:
 *   node media-orphans.mjs --url <db>                 → فقط گزارش (امن — پیش‌فرض)
 *   node media-orphans.mjs --url <db> --delete        → حذف فایل‌های یتیم قدیمی‌تر از حد سن
 *   --min-age-hours N (پیش‌فرض ۱) — فقط فایل‌های قدیمی‌تر از N ساعت حذف می‌شوند
 *
 * قواعد سخت: هرگز ردیف DB حذف نمی‌کند؛ هرگز خارج از MEDIA_DIR نمی‌رود؛
 * گزارش همیشه قبل از حذف چاپ می‌شود؛ بدون --delete هیچ نوشتنی رخ نمی‌دهد.
 */
import { createRequire } from "node:module";
import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const url = arg("url", process.env.DATABASE_URL ?? "postgresql://postgres:ghasedak-dev-pw@127.0.0.1:5433/ghasedak");
const doDelete = process.argv.includes("--delete");
const minAgeHours = Number(arg("min-age-hours", "1"));

const toolsRequire = createRequire("C:/ghasedak-tools/pg-client/package.json");
const { Client } = toolsRequire("pg");

const MEDIA_DIR = resolve("C:/Users/milad/OneDrive/Desktop/سایت فریباف/apps/data/media");

const c = new Client({ connectionString: url });
await c.connect();
const { rows } = await c.query(`SELECT "storageKey" FROM "Media"`);
await c.end();
const known = new Set(rows.map((r) => r.storageKey));

const files = readdirSync(MEDIA_DIR).filter((f) => statSync(join(MEDIA_DIR, f)).isFile());
const orphans = [];
for (const f of files) {
  if (!known.has(f)) {
    const st = statSync(join(MEDIA_DIR, f));
    orphans.push({ file: f, sizeBytes: st.size, ageHours: (Date.now() - st.mtimeMs) / 3600_000 });
  }
}

console.log(`MEDIA_DIR: ${MEDIA_DIR}`);
console.log(`DB rows: ${known.size} | files on disk: ${files.length} | orphans: ${orphans.length}`);
for (const o of orphans) {
  console.log(`  orphan: ${o.file} (${o.sizeBytes}B, ${(o.ageHours).toFixed(1)}h old)`);
}

if (!doDelete) {
  console.log("\nREPORT-ONLY (بدون --delete هیچ چیز حذف نمی‌شود)");
  process.exit(0);
}

const eligible = orphans.filter((o) => o.ageHours >= minAgeHours);
const skipped = orphans.length - eligible.length;
let deleted = 0;
for (const o of eligible) {
  const safe = resolve(MEDIA_DIR, o.file);
  if (!safe.startsWith(MEDIA_DIR)) continue; // path traversal گارد
  try {
    unlinkSync(safe);
    deleted++;
    console.log(`  deleted: ${o.file}`);
  } catch (e) {
    console.log(`  FAILED delete ${o.file}: ${e.message}`);
  }
}
console.log(`\nDELETED=${deleted} SKIPPED (younger than ${minAgeHours}h)=${skipped}`);
