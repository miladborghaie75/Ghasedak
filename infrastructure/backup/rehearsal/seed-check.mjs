/**
 * seed-check.mjs — Step 10/11: شمارش کلیدی قبل/بعد seed و کنترل خزانه.
 * usage: node seed-check.mjs --label pre|post1|post2
 */
import { createRequire } from "node:module";
const toolsRequire = createRequire("C:/ghasedak-tools/pg-client/package.json");
const { Client } = toolsRequire("pg");
import { assertSafeUrl } from "./_safety.mjs";

const label = process.argv[process.argv.indexOf("--label") + 1] ?? "snap";
const c = new Client({ connectionString: assertSafeUrl(
  process.env.REHEARSAL_URL ?? "postgresql://postgres:rehearsal-pw@127.0.0.1:55432/ghasedak_recovery_rehearsal",
  { label: "seed-check" },
) });
await c.connect();

const TABLES = ["User","Permission","RolePermission","NumberSeries","CashAccount","BankAccount","Account",
  "JournalEntry","JournalLine","FiscalYear","PriceLevel","SalesChannel","PaymentMethod","PaymentProvider",
  "TaxRate","Category","Brand","Attribute","AttributeTerm","Product","ProductVariant","VariantPrice",
  "VariantBarcode","Warehouse","ShippingZone","ShippingMethod","FeatureFlag"];

const counts = {};
for (const t of TABLES) {
  const r = await c.query(`SELECT count(*)::int n FROM "${t}"`);
  counts[t] = r.rows[0].n;
}

// خزانه: مانده‌ها باید از GL بیایند نه عدد ثابت
const treasury = (await c.query(`
  SELECT 'cash' k, id, name, "currentBalance"::text bal,
    (SELECT (COALESCE(SUM(l.debit),0)-COALESCE(SUM(l.credit),0))::text FROM "JournalLine" l WHERE l."accountId"=a."glAccountId") glbal
  FROM "CashAccount" a
  UNION ALL
  SELECT 'bank', id, name, "currentBalance"::text,
    (SELECT (COALESCE(SUM(l.debit),0)-COALESCE(SUM(l.credit),0))::text FROM "JournalLine" l WHERE l."accountId"=b."glAccountId")
  FROM "BankAccount" b
`)).rows;
for (const t of treasury) t.match = t.bal === t.glbal;

await c.end();
console.log(JSON.stringify({ label, counts, treasury }, null, 1));
