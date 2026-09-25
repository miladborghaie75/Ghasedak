/**
 * ns-invariant.mjs — PHASE 2: بررسی invariant شماره‌گذاری روی دادهٔ بازیابی‌شده (read-only).
 * invariant: nextNumber سری > max(شماره سند موجود) برای همهٔ سری‌ها/جدول‌ها.
 */
import { createRequire } from "node:module";
const toolsRequire = createRequire("C:/ghasedak-tools/pg-client/package.json");
const { Client } = toolsRequire("pg");
import { assertSafeUrl } from "./_safety.mjs";

const c = new Client({ connectionString: assertSafeUrl(
  process.env.REHEARSAL_URL ?? "postgresql://postgres:rehearsal-pw@127.0.0.1:55432/ghasedak_recovery_rehearsal",
  { label: "ns-invariant" },
) });
await c.connect();

const cols = (await c.query(
  `SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'number'`
)).rows.map(r => r.table_name);

const series = (await c.query(`SELECT scope, prefix, "nextNumber" nn, padding FROM "NumberSeries" ORDER BY scope`)).rows;

const report = [];
for (const s of series) {
  const maxima = [];
  for (const t of cols) {
    const rx = `^${s.prefix}-([0-9]+)$`;
    const r = await c.query(
      `SELECT MAX(((regexp_match("number", $1))[1])::bigint) mx FROM "${t}" WHERE "number" ~ $1`,
      [rx]
    );
    if (r.rows[0].mx != null) maxima.push({ table: t, max: Number(r.rows[0].mx) });
  }
  const maxAll = maxima.length ? Math.max(...maxima.map(m => m.max)) : null;
  report.push({
    scope: s.scope, prefix: s.prefix, next: s.nn, maxDoc: maxAll,
    where: maxima.map(m => m.table).join(","),
    ok: maxAll == null || s.nn > maxAll,
  });
}

// اسناد خزانه (RCP/PMT) که سری‌شان در بکاپ نیست — باید هیچ سندی وجود نداشته باشد
const treasuryDocs = [];
for (const t of cols) {
  for (const p of ["RCP", "PMT", "TRF"]) {
    const rx = `^${p}-[0-9]+$`;
    const r = await c.query(`SELECT count(*)::int n FROM "${t}" WHERE "number" ~ $1`, [rx]);
    if (r.rows[0].n > 0) treasuryDocs.push(`${t}:${p}=${r.rows[0].n}`);
  }
}

await c.end();
console.log(JSON.stringify(report, null, 1));
console.log("treasury RCP/PMT/TRF docs anywhere:", treasuryDocs.length ? treasuryDocs : "none (auto-start at 1 is safe)");
const violations = report.filter(r => !r.ok);
console.log("VIOLATIONS:", violations.length);
process.exit(violations.length ? 1 : 0);
