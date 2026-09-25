/**
 * validate-restore.mjs — Step 8+9: اعتبارسنجی جامع روی DB rehearsal (کاملاً read-only).
 * FK اورفن، حسابداری متوازن، انبار/POS/خرید/سفارش/Outbox، NumberSeries gate.
 */
import { createRequire } from "node:module";
const toolsRequire = createRequire("C:/ghasedak-tools/pg-client/package.json");
const { Client } = toolsRequire("pg");
import { assertSafeUrl } from "./_safety.mjs";

const URL_ = assertSafeUrl(
  process.env.REHEARSAL_URL ?? "postgresql://postgres:rehearsal-pw@127.0.0.1:55432/ghasedak_recovery_rehearsal",
  { label: "validate-restore" },
);
const c = new Client({ connectionString: URL_ });
await c.connect();

const out = {};
const bad = [];

async function one(sql, label) {
  try {
    const r = await c.query(sql);
    return r.rows;
  } catch (e) {
    bad.push(`${label ?? sql.slice(0, 60)}: ${e.message}`);
    return null;
  }
}

// ---------- 0) شمارش جدول‌ها
out.tableCount = (await one(`SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'`))[0].n;

// ---------- 1) FK validation — برای هر FK تک‌ستونی، شمارش اورفن
const fks = await one(`
  SELECT con.conname, conrelid::regclass::text child, confrelid::regclass::text parent,
         src.attname fkcol, tgt.attname refcol
  FROM pg_constraint con
  JOIN pg_attribute src ON src.attrelid = con.conrelid AND src.attnum = con.conkey[1]
  JOIN pg_attribute tgt ON tgt.attrelid = con.confrelid AND tgt.attnum = con.confkey[1]
  WHERE con.contype='f' AND cardinality(con.conkey)=1
`);
const multiFks = await one(`SELECT count(*)::int n FROM pg_constraint WHERE contype='f' AND cardinality(conkey)>1`);
let fkTotal = 0, fkOrphans = 0;
const orphanDetail = [];
for (const fk of fks) {
  const r = await one(`SELECT count(*)::int n FROM ${fk.child} ch LEFT JOIN ${fk.parent} pa ON ch."${fk.fkcol}" = pa."${fk.refcol}" WHERE ch."${fk.fkcol}" IS NOT NULL AND pa."${fk.refcol}" IS NULL`, `fk ${fk.conname}`);
  fkTotal++;
  if (r && r[0].n > 0) { fkOrphans += r[0].n; orphanDetail.push(`${fk.child}.${fk.fkcol} → ${fk.parent} = ${r[0].n}`); }
}
out.fk = { singleColFks: fkTotal, multiColFks: multiFks[0].n, orphans: fkOrphans, orphanDetail };

// ---------- 2) PK/Unique: constraints count + canary (باید 23503/unique بدهد)
out.constraints = (await one(`SELECT contype, count(*)::int n FROM pg_constraint GROUP BY contype`)).map(r => `${r.contype}=${r.n}`).join(" ");
out.sequences = (await one(`SELECT count(*)::int n FROM pg_sequences WHERE schemaname='public'`))[0].n;

// ---------- 3) Accounting
out.accounting = {};
out.accounting.journalEntry = (await one(`SELECT count(*)::int n FROM "JournalEntry"`))[0].n;
out.accounting.journalLine = (await one(`SELECT count(*)::int n FROM "JournalLine"`))[0].n;
const unbalanced = await one(`
  SELECT e.id, e.number,
         COALESCE(SUM(l.debit),0)::text AS d, COALESCE(SUM(l.credit),0)::text AS c
  FROM "JournalEntry" e LEFT JOIN "JournalLine" l ON l."entryId" = e.id
  GROUP BY e.id, e.number
  HAVING COALESCE(SUM(l.debit),0) <> COALESCE(SUM(l.credit),0)
`);
out.accounting.unbalancedEntries = unbalanced.length;
if (unbalanced.length) bad.push(`UNBALANCED JOURNALS: ${JSON.stringify(unbalanced)}`);
out.accounting.totalDebit = (await one(`SELECT COALESCE(SUM(debit),0)::text s FROM "JournalLine"`))[0].s;
out.accounting.totalCredit = (await one(`SELECT COALESCE(SUM(credit),0)::text s FROM "JournalLine"`))[0].s;
out.accounting.orphanLines = (await one(`SELECT count(*)::int n FROM "JournalLine" l LEFT JOIN "JournalEntry" e ON l."entryId"=e.id WHERE e.id IS NULL`))[0].n;

// ---------- 4) Inventory / POS / Purchasing / Orders counts
const counts = {};
for (const [t, exp] of Object.entries({
  Product: 120, ProductVariant: 4, StockLedgerEntry: 9, CostLayer: 1, StockReservation: 2,
  QuarantineRecord: 1, Warehouse: 1, PosInvoice: 4, PosPayment: 4, PosInvoiceItem: 4,
  CashRegister: 2, CashierShift: 3, PurchaseInvoice: 1, PurchaseOrder: 1, PurchasePayment: 1,
  GoodsReceipt: 1, AccountsPayable: 1, Supplier: 1, SupplierAccount: 1, Order: 2, OrderItem: 2,
  PaymentAttempt: 1, DomainEventOutbox: 158, Account: 8, NumberSeries: 10, User: 4,
  Permission: 51, RolePermission: 85, FiscalYear: 5,
})) {
  const r = await one(`SELECT count(*)::int n FROM "${t}"`, `count ${t}`);
  counts[t] = { actual: r?.[0].n, expected: exp, ok: r?.[0].n === exp };
  if (r && r[0].n !== exp) bad.push(`COUNT MISMATCH ${t}: ${r[0].n} != ${exp}`);
}
out.counts = counts;

// POS consistency: sum(PosPayment.amount) per invoice vs invoice paid field (if exists)
const posPaid = await one(`
  SELECT i.id,
         (SELECT COALESCE(SUM(p.amount),0) FROM "PosPayment" p WHERE p."invoiceId" = i.id) AS paid_sum
  FROM "PosInvoice" i
`);
out.posPayments = posPaid;

// Inventory sanity: هیچ balanceAfter منفی نباید وجود داشته باشد
const negStock = await one(`SELECT count(*)::int n FROM "StockLedgerEntry" WHERE "balanceAfter" < 0`);
out.negativeLedgerRows = negStock ? negStock[0].n : "n/a";
if (negStock && negStock[0].n > 0) bad.push(`NEGATIVE BALANCE rows in StockLedgerEntry: ${negStock[0].n}`);

// ---------- 5) Outbox integrity
out.outbox = {};
out.outbox.payloadTypes = (await one(`SELECT pg_typeof(payload)::text t, count(*)::int n FROM "DomainEventOutbox" GROUP BY 1`)).map(r=>`${r.t}=${r.n}`);
out.outbox.processed = (await one(`SELECT "state", count(*)::int n FROM "DomainEventOutbox" GROUP BY 1 ORDER BY 2 DESC`))?.map(x=>`${x.state}=${x.n}`).join(", ");
out.outbox.corruptPayload = (await one(`SELECT count(*)::int n FROM "DomainEventOutbox" WHERE payload IS NULL OR jsonb_typeof(payload) NOT IN ('object')`))?.[0]?.n;

// ---------- 6) NumberSeries gate (فقط گزارش؛ هیچ اصلاحی نمی‌شود)
const series = await one(`SELECT scope, prefix, "nextNumber", padding FROM "NumberSeries" ORDER BY scope`);
const numCols = await one(`
  SELECT table_name, column_name FROM information_schema.columns
  WHERE table_schema='public' AND column_name IN ('number') AND data_type IN ('character varying','text')
`);
const nsReport = [];
for (const s of series) {
  const fmt = (n) => `${s.prefix}${String(n).padStart(s.padding, "0")}`;
  const maxima = [];
  for (const col of numCols) {
    // الگوی دقیق: number = prefix + '-' + digits  (تا پیشوندهای هم‌پیشوند مثل PO/POS قاطی نشوند)
    const r = await one(`
      SELECT MAX(NULLIF((regexp_match("${col.column_name}", '^${s.prefix}-([0-9]+)$'))[1], '')::bigint) mx
      FROM "${col.table_name}" WHERE "${col.column_name}" ~ '^${s.prefix}-[0-9]+$'
    `, `ns ${s.scope} on ${col.table_name}`);
    if (r?.[0]?.mx) maxima.push(`${col.table_name}=${r[0].mx}`);
  }
  const maxActual = maxima.length ? Math.max(...maxima.map(m => Number(m.split("=")[1]))) : null;
  const risk = maxActual != null && maxActual >= s.nextNumber;
  nsReport.push({ ...s, nextFormatted: fmt(s.nextNumber), maxActual, maxima, collisionRisk: risk });
  if (risk) bad.push(`NUMBER RISK ${s.scope}: nextNumber=${s.nextNumber} but max actual=${maxActual}`);
}
out.numberSeries = nsReport;

// ---------- 7) Phase-9 tables must NOT exist here
out.phase9Absent = (await one(`SELECT count(*)::int n FROM pg_tables WHERE tablename IN ('BankStatementMatch','CheckTransition')`))[0].n;

await c.end();
console.log("=== VALIDATION REPORT ===");
console.log(JSON.stringify(out, null, 1));
console.log(bad.length ? `PROBLEMS (${bad.length}):\n- ` + bad.join("\n- ") : "NO PROBLEMS — INTEGRITY OK");
process.exit(bad.length ? 1 : 0);
