/**
 * smoke-readonly.mjs — PHASE 10 Execution Gate: smoke فقط-خواندنی روی API متصل به Primary.
 * هیچ POST business transaction نمی‌زند؛ فقط GET + auth.
 * write-detector: max(updatedAt) جداول دامنه‌ای قبل/بعد باید identical باشد.
 * usage: SMOKE_BASE=http://127.0.0.1:4001/api/v1 REHEARSAL_URL=<primary> node smoke-readonly.mjs
 */
import { createRequire } from "node:module";
import { assertSafeUrl } from "./_safety.mjs";
const toolsRequire = createRequire("C:/ghasedak-tools/pg-client/package.json");
const { Client } = toolsRequire("pg");

const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4001/api/v1";
const REHEARSAL_URL = assertSafeUrl(
  process.env.REHEARSAL_URL ?? "postgresql://postgres:rehearsal-pw@127.0.0.1:55432/ghasedak_recovery_rehearsal",
  { label: "smoke-readonly" },
);

const out = {};
let cookie = "";
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setc = res.headers.get("set-cookie");
  if (setc) cookie = setc.split(";")[0];
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}
const R = (name, ok, detail) => {
  out[name] = { ok, ...(detail ? { detail } : {}) };
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail ? JSON.stringify(detail).slice(0, 200) : ""}`);
};

const db = new Client({ connectionString: REHEARSAL_URL });
await db.connect();
const q = (sql) => db.query(sql);

// write-detector: جدول‌های دامنه‌ای (AdminSession/AuditLog عمداً خارج‌اند — login خودشان می‌سازد)
const WATCHED = ["PosInvoice", "PosPayment", "PosInvoiceItem", "CashierShift", "JournalEntry", "JournalLine",
  "StockLedgerEntry", "DomainEventOutbox", "PurchaseOrder", "GoodsReceipt", "PurchaseInvoice",
  "AccountsPayable", "PurchasePayment", "Order", "PaymentAttempt", "CashAccount", "BankAccount", "NumberSeries"];
const stamp = async () => {
  const cols = await q(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN (${WATCHED.map((t) => `'${t}'`).join(",")}) AND column_name IN ('updatedAt','createdAt')`);
  const rows = [];
  for (const t of WATCHED) {
    const cs = cols.rows.filter((r) => r.table_name === t).map((r) => r.column_name);
    const col = cs.includes("updatedAt") ? "updatedAt" : cs.includes("createdAt") ? "createdAt" : null;
    const expr = col ? `COALESCE(MAX("${col}"),'epoch'::timestamptz)::text` : `'none'`;
    const r = await q(`SELECT count(*)::int n, ${expr} s FROM "${t}"`);
    rows.push(`${t}:${r.rows[0].n}:${r.rows[0].s}`);
  }
  return rows.join("|");
};

// ---- 0) health
{
  const r = await api("GET", "/health");
  R("health", r.status === 200, { status: r.status, body: r.json });
}

const before = await stamp();

// ---- 1) login + RBAC
{
  const r = await api("POST", "/auth/login", { email: "admin@ghasedak.demo", password: "Ghasedak#Demo1" });
  R("admin_auth", r.status === 200, { status: r.status, email: r.json?.user?.email ?? r.json?.email ?? null });
}
{
  const r = await api("GET", "/admin/users");
  R("admin_users_read", r.status === 200, { status: r.status, count: Array.isArray(r.json) ? r.json.length : (Array.isArray(r.json?.items) ? r.json.items.length : null) });
}

// ---- 2) Treasury reads
{
  const acc = await api("GET", "/admin/treasury/accounts");
  const sum = await api("GET", "/admin/treasury/summary");
  R("treasury_reads", acc.status === 200 && sum.status === 200, { accounts: acc.status, summary: sum.status });
  // historical treasury via API payload if present
  if (sum.status === 200 && sum.json) R("treasury_summary_payload", true, sum.json);
}

// ---- 3) POS reads
{
  const inv = await api("GET", "/pos/invoices");
  const cur = await api("GET", "/pos/shift/current");
  R("pos_reads", inv.status === 200 && cur.status === 200, { invoices: inv.status, currentShift: cur.status, invoicesCount: Array.isArray(inv.json) ? inv.json.length : (Array.isArray(inv.json?.items) ? inv.json.items.length : null) });
}

// ---- 4) Purchasing reads
{
  const sup = await api("GET", "/admin/purchasing/suppliers");
  const po = await api("GET", "/admin/purchasing/purchase-orders");
  const grn = await api("GET", "/admin/purchasing/goods-receipts");
  const pinv = await api("GET", "/admin/purchasing/purchase-invoices");
  R("purchasing_reads", sup.status === 200 && po.status === 200 && grn.status === 200 && pinv.status === 200,
    { suppliers: sup.status, purchaseOrders: po.status, goodsReceipts: grn.status, purchaseInvoices: pinv.status });
}

// ---- 5) Orders/Payments reads (read-only probing of list endpoints if exposed)
{
  const pay = await api("GET", "/admin/payments");
  R("payments_read", pay.status === 200 || pay.status === 404, { status: pay.status, note: pay.status === 404 ? "no admin payments list endpoint (ok)" : undefined });
}

// ---- 6) DB assertions: outbox untouched, accounting intact, treasury projection
{
  const ob = await q(`SELECT state, count(*)::int n FROM "DomainEventOutbox" GROUP BY 1 ORDER BY 2 DESC`);
  const failed = ob.rows.find((r) => r.state === "FAILED");
  R("outbox_failed_158", Number(failed?.n) === 158, { failedCount: failed?.n ?? 0 });
  const pend = ob.rows.filter((r) => r.state !== "FAILED").reduce((a, r) => a + Number(r.n), 0);
  R("outbox_no_replayed_or_new", pend === 0, { nonFailed: pend });
  const corrupt = await q(`SELECT count(*)::int n FROM "DomainEventOutbox" WHERE state='FAILED' AND (payload IS NULL OR jsonb_typeof(payload) <> 'object')`);
  R("outbox_payloads_valid", Number(corrupt.rows[0].n) === 0, { corrupt: corrupt.rows[0].n });

  const acc = await q(`SELECT (SELECT count(*)::int FROM "JournalEntry") je, (SELECT count(*)::int FROM "JournalLine") jl,
    (SELECT COALESCE(SUM(debit),0)::text FROM "JournalLine") d, (SELECT COALESCE(SUM(credit),0)::text FROM "JournalLine") c`);
  R("accounting_intact", acc.rows[0].je === 20 && acc.rows[0].jl === 40 && acc.rows[0].d === acc.rows[0].c,
    { je: acc.rows[0].je, jl: acc.rows[0].jl, d: acc.rows[0].d, c: acc.rows[0].c });

  const tr = await q(`SELECT 'cash' k, a."currentBalance"::text bal,
    (SELECT (COALESCE(SUM(l.debit),0)-COALESCE(SUM(l.credit),0))::text FROM "JournalLine" l WHERE l."accountId"=a."glAccountId") gl
    FROM "CashAccount" a
    UNION ALL
    SELECT 'bank', b."currentBalance"::text,
    (SELECT (COALESCE(SUM(l.debit),0)-COALESCE(SUM(l.credit),0))::text FROM "JournalLine" l WHERE l."accountId"=b."glAccountId")
    FROM "BankAccount" b`);
  R("treasury_gl_projection", tr.rows.every((r) => r.bal === r.gl), tr.rows);
}

const after = await stamp();
R("write_detector_no_mutation", before === after, { changed: before !== after ? WATCHED.filter((t, i) => before.split("|")[i] !== after.split("|")[i]) : undefined });

await db.end();
const fails = Object.entries(out).filter(([, v]) => !v.ok);
console.log(fails.length ? `SMOKE_READONLY_FAILED (${fails.length})` : "SMOKE_READONLY_ALL_PASSED");
process.exit(fails.length ? 1 : 0);
