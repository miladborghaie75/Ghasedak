/**
 * pg-query.mjs — اجرای یک query فقط-خواندنی (SELECT/SHOW) روی مقصد با گارد مشترک.
 * صرفاً ابزار تشخیصی برای PHASE 2/3/… Execution Gate؛ هر چیز غیر SELECT/SHOW رد می‌شود.
 * usage: node pg-query.mjs "SELECT 1"   (URL از REHEARSAL_URL)
 */
import { createRequire } from "node:module";
const toolsRequire = createRequire("C:/ghasedak-tools/pg-client/package.json");
const { Client } = toolsRequire("pg");
import { assertSafeUrl } from "./_safety.mjs";

const sql = process.argv[2];
if (!sql) {
  console.error("usage: node pg-query.mjs \"<SELECT/SHOW query>\"");
  process.exit(2);
}
if (!/^\s*(SELECT|SHOW)\b/i.test(sql)) {
  console.error("REFUSED: pg-query.mjs only runs SELECT/SHOW (read-only diagnostic tool)");
  process.exit(3);
}
const URL_ = assertSafeUrl(
  process.env.REHEARSAL_URL ?? "postgresql://postgres:rehearsal-pw@127.0.0.1:55432/ghasedak_recovery_rehearsal",
  { label: "pg-query" },
);
const c = new Client({ connectionString: URL_ });
await c.connect();
try {
  const r = await c.query(sql);
  if (Array.isArray(r)) {
    for (const res of r) console.log(JSON.stringify(res.rows, null, 1));
  } else {
    console.log(JSON.stringify(r.rows, null, 1));
  }
} finally {
  await c.end().catch(() => {});
}
