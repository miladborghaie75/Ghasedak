/**
 * outbox-policy.mjs — PHASE 3: گروه‌بندی رویدادهای FAILED تاریخی (read-only) برای طبقه‌بندی policy.
 */
import { createRequire } from "node:module";
const toolsRequire = createRequire("C:/ghasedak-tools/pg-client/package.json");
const { Client } = toolsRequire("pg");

const c = new Client({ connectionString: "postgresql://postgres:rehearsal-pw@127.0.0.1:55432/ghasedak_recovery_rehearsal" });
await c.connect();

const g = await c.query(`
  SELECT name, attempts, count(*)::int n,
         MIN("createdAt") AS first_at, MAX("createdAt") AS last_at,
         MIN(left(regexp_replace("lastError", $1, $2, $3), 100)) AS err
  FROM "DomainEventOutbox" WHERE state = $4
  GROUP BY name, attempts ORDER BY n DESC`, ["\\n.*", "", "g", "FAILED"]);

console.log(JSON.stringify(g.rows, null, 1));

for (const row of g.rows) {
  const p = await c.query(`SELECT payload FROM "DomainEventOutbox" WHERE name = $1 LIMIT 1`, [row.name]);
  console.log("---", row.name, "payload:", JSON.stringify(p.rows[0].payload).slice(0, 300));
}

await c.end();
