/**
 * smoke.mjs — Step 13-16: smoke کامل روی API rehearsal (پورت 4001).
 * هرگز به 5433 دست نمی‌زند؛ فقط تست و گزارش است.
 */
import { createRequire } from "node:module";
import { assertSafeUrl } from "./_safety.mjs";
const toolsRequire = createRequire("C:/ghasedak-tools/pg-client/package.json");
const { Client } = toolsRequire("pg");
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4001/api/v1";
const REHEARSAL_URL = assertSafeUrl(
  process.env.REHEARSAL_URL ?? "postgresql://postgres:rehearsal-pw@127.0.0.1:55432/ghasedak_recovery_rehearsal",
  { label: "smoke" },
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
const R = (name, ok, detail) => { out[name] = { ok, ...(detail ? { detail } : {}) }; console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail ? JSON.stringify(detail).slice(0, 220) : ""}`); };

const db = new Client({ connectionString: REHEARSAL_URL });
await db.connect();
const q = (sql, p) => db.query(sql, p);
const pre = {};   // شمارش‌های قبل از smoke
const post = {};  // بعد از smoke
const snap = async () => {
  const r = await q(`SELECT
    (SELECT count(*) FROM "PosInvoice") pos,
    (SELECT count(*) FROM "PosPayment") pospay,
    (SELECT count(*) FROM "JournalEntry") je,
    (SELECT count(*) FROM "JournalLine") jl,
    (SELECT count(*) FROM "StockLedgerEntry") sle,
    (SELECT count(*) FROM "DomainEventOutbox") outbox,
    (SELECT count(*) FROM "PurchaseOrder") po,
    (SELECT count(*) FROM "GoodsReceipt") grn,
    (SELECT count(*) FROM "PurchaseInvoice") pinv,
    (SELECT count(*) FROM "AccountsPayable") ap,
    (SELECT count(*) FROM "PurchasePayment") ppay,
    (SELECT count(*) FROM "PaymentAttempt") pa,
    (SELECT count(*) FROM "CashierShift") shifts,
    (SELECT count(*) FROM "NumberSeries") ns`);
  return r.rows[0];
};

// ---- 0) health
{
  const r = await api("GET", "/health");
  R("health", r.status === 200, { status: r.status, body: r.json });
}

// ---- 1) login
{
  const r = await api("POST", "/auth/login", { email: "admin@ghasedak.demo", password: "Ghasedak#Demo1" });
  R("login", r.status === 200, { status: r.status, email: r.json?.user?.email ?? r.json?.email ?? null });
}

// ---- 2) admin probe
{
  const r = await api("GET", "/admin/users");
  R("admin_users", r.status === 200, { status: r.status, count: Array.isArray(r.json) ? r.json.length : null });
}

// ---- 3) treasury reads (مسیر واقعی: admin/treasury)
{
  const acc = await api("GET", "/admin/treasury/accounts");
  const sum = await api("GET", "/admin/treasury/summary");
  R("treasury_reads", acc.status === 200 && sum.status === 200, { acc: acc.status, sum: sum.status });
}

// ---- 4) POS reads
{
  const inv = await api("GET", "/pos/invoices");
  const cur = await api("GET", "/pos/shift/current");
  R("pos_reads", inv.status === 200 && cur.status === 200, { invoices: inv.status, current: cur.status });
}

// ---- 5) POS sale flow
pre.pos = await snap();
let saleNumber = null;
let shiftId = null;
{
  // اگر شیفت بازی موجود است (از داده‌های بکاپ) از همان استفاده می‌کنیم؛ وگرنه باز می‌کنیم
  const cur = await api("GET", "/pos/shift/current");
  if (cur.json?.id) {
    shiftId = cur.json.id;
    R("pos_shift_reuse", true, { reusedShiftId: shiftId });
  } else {
    const open = await api("POST", "/pos/shift/open", { registerName: "MAIN", openingCash: 0 });
    R("pos_shift_open", open.status === 200 || open.status === 201, { status: open.status, body: open.json });
    shiftId = open.json?.id ?? open.json?.shift?.id ?? null;
  }

  const skuRow = await q(`SELECT sku FROM "ProductVariant" ORDER BY sku LIMIT 1`);
  const sku = skuRow.rows[0]?.sku;
  const sale = await api("POST", "/pos/sale", {
    shiftId, lines: [{ sku, qty: 1 }], payments: [{ methodCode: "cash", amount: 749000 }],
    customerName: "Smoke (REHEARSAL)", idempotencyKey: "rehearsal-smoke-pos-" + Date.now(),
  });
  R("pos_sale", sale.status === 200 || sale.status === 201, { status: sale.status, body: sale.json });
  saleNumber = sale.json?.number ?? null;
}
post.pos = await snap();

// POS assertions
{
  const dp = Number(post.pos.pos) - Number(pre.pos.pos);
  const dj = Number(post.pos.je) - Number(pre.pos.je);
  const dl = Number(post.pos.jl) - Number(pre.pos.jl);
  const dsle = Number(post.pos.sle) - Number(pre.pos.sle);
  const dns = Number(post.pos.ns) - Number(pre.pos.ns);
  R("pos_created_invoice", dp === 1, { delta: dp, number: saleNumber });
  R("pos_journal_created", dj >= 1 && dl >= 2, { dJe: dj, dJl: dl });
  R("pos_ledger_entry", dsle >= 1, { dSle: dsle });
  R("pos_numberseries_intact", dns === 0, { dNs: dns });
  const bal = await q(`SELECT COALESCE(SUM(l.debit),0)::text d, COALESCE(SUM(l.credit),0)::text c
    FROM "JournalLine" l JOIN "JournalEntry" e ON l."entryId"=e.id
    WHERE e."createdAt" > (SELECT MAX("createdAt") - interval '10 minutes' FROM "JournalEntry" WHERE "number" NOT LIKE '%SMOKE%')`);
  // به‌جای حدس بازه، توازن کل DB بعد از smoke را می‌سنجیم:
  const all = await q(`SELECT COALESCE(SUM(debit),0)::text d, COALESCE(SUM(credit),0)::text c FROM "JournalLine"`);
  R("ledger_balanced_total", all.rows[0].d === all.rows[0].c, { d: all.rows[0].d, c: all.rows[0].c });
}

// ---- 6) Purchase flow: PO → send → GRN → Invoice → AP → pay
pre.pur = await snap();
{
  const sup = await q(`SELECT id FROM "Supplier" LIMIT 1`);
  const supplierId = sup.rows[0]?.id;
  const skuRow = await q(`SELECT sku FROM "ProductVariant" ORDER BY sku LIMIT 1`);
  const sku = skuRow.rows[0]?.sku;

  const po = await api("POST", "/admin/purchasing/purchase-orders", { supplierId, lines: [{ variantSku: sku, qty: 2, unitCost: 500000 }] });
  R("purchase_order_create", po.status === 200 || po.status === 201, { status: po.status, body: po.json });
  const poId = po.json?.id ?? null;
  const wh = await q(`SELECT id FROM "Warehouse" ORDER BY priority LIMIT 1`);
  const warehouseId = wh.rows[0]?.id;

  if (poId) {
    const send = await api("POST", `/admin/purchasing/purchase-orders/${poId}/send`);
    R("purchase_order_send", send.status === 200 || send.status === 201, { status: send.status });
    const grn = await api("POST", "/admin/purchasing/goods-receipts", {
      supplierId, warehouseId, poId,
      lines: [{ variantSku: sku, qty: 2, unitCost: 500000 }],
    });
    R("goods_receipt", grn.status === 200 || grn.status === 201, { status: grn.status, body: grn.json });
    const grnId = grn.json?.id ?? grn.json?.grn?.id ?? grn.json?.goodsReceipt?.id ?? null;
    const inv = await api("POST", "/admin/purchasing/purchase-invoices", {
      supplierId, grnId, lines: [{ variantSku: sku, qty: 2, unitCost: 500000 }],
    });
    R("purchase_invoice", inv.status === 200 || inv.status === 201, { status: inv.status, body: inv.json });
    const invId = inv.json?.invoice?.id ?? inv.json?.id ?? null;
    if (invId) {
      const pay = await api("POST", `/admin/purchasing/purchase-invoices/${invId}/pay`, { amount: 1000000, method: "cash" });
      R("supplier_payment", pay.status === 200 || pay.status === 201, { status: pay.status, body: pay.json });
    }
  }
}
post.pur = await snap();
{
  const d = (k) => Number(post.pur[k]) - Number(pre.pur[k]);
  R("purchase_chain_created", d("po") >= 1 && d("grn") >= 1 && d("pinv") >= 1 && d("ap") >= 1, {
    po: d("po"), grn: d("grn"), pinv: d("pinv"), ap: d("ap"), ppay: d("ppay"),
  });
  const all = await q(`SELECT COALESCE(SUM(debit),0)::text d, COALESCE(SUM(credit),0)::text c FROM "JournalLine"`);
  R("ledger_balanced_after_purchase", all.rows[0].d === all.rows[0].c, { d: all.rows[0].d, c: all.rows[0].c });
  R("numberseries_still_intact", Number(post.pur.ns) - Number(pre.pur.ns) === 0, {});
}

// ---- 6b) Treasury smoke: واریز → برداشت → انتقال (سند + مانده اتمیک)
{
  const cashId = "demo-cash-main", bankId = "demo-bank-main";
  const t0 = await api("GET", "/admin/treasury/summary");
  const rIn = await api("POST", "/admin/treasury/cash-in", { accountId: cashId, amount: 500000, counterAccountCode: "3000", description: "rehearsal R2 cash-in" });
  R("treasury_cash_in", rIn.status === 200 || rIn.status === 201, { status: rIn.status, body: rIn.json });
  const rOut = await api("POST", "/admin/treasury/cash-out", { accountId: cashId, amount: 200000, counterAccountCode: "6000", description: "rehearsal R2 cash-out" });
  R("treasury_cash_out", rOut.status === 200 || rOut.status === 201, { status: rOut.status, body: rOut.json });
  const rTr = await api("POST", "/admin/treasury/transfer", { fromId: cashId, toId: bankId, amount: 300000, description: "rehearsal R2 transfer" });
  R("treasury_transfer", rTr.status === 200 || rTr.status === 201, { status: rTr.status, body: rTr.json });
}

// ---- 7) Online payment start (بدون credential واقعی — باید خطای پیکربندی بدهد نه کرش)
{
  const ord = await q(`SELECT id FROM "Order" ORDER BY "createdAt" LIMIT 1`);
  const orderId = ord.rows[0]?.id;
  const r = await api("POST", "/payments/start", { orderId, idempotencyKey: "rehearsal-smoke-pay-" + Date.now(), callbackUrl: "http://localhost:3000/callback" });
  const graceful = r.status === 200 || r.status === 201 || (r.status >= 400 && r.json?.code !== undefined);
  R("online_payment_graceful", graceful, { status: r.status, body: r.json });
}

// ---- 8) outbox پس از smoke: قدیمی‌های FAILED نباید تغییر کرده باشند + رویدادهای جدید سالم
{
  const ob = await q(`SELECT state, count(*)::int n FROM "DomainEventOutbox" GROUP BY 1 ORDER BY 2 DESC`);
  const failed = ob.rows.find(r => r.state === "FAILED");
  R("historical_failed_untouched", Number(failed?.n) === 158, { failedCount: failed?.n });
  const fresh = await q(`SELECT count(*)::int n FROM "DomainEventOutbox" WHERE state IN ('PENDING','DISPATCHED') AND "lastError" IS NULL`);
  R("new_events_healthy", Number(fresh.rows[0].n) >= 1, { newHealthy: fresh.rows[0].n });
  const corrupt = await q(`SELECT count(*)::int n FROM "DomainEventOutbox" WHERE state <> 'FAILED' AND (payload IS NULL OR jsonb_typeof(payload) <> 'object')`);
  R("new_payloads_valid", Number(corrupt.rows[0].n) === 0, { corrupt: corrupt.rows[0].n });
  // مانده خزانه بعد از عملیات باید باز هم دقیقاً GL باشد
  const tr = await q(`SELECT 'cash' k, a."currentBalance"::text bal,
    (SELECT (COALESCE(SUM(l.debit),0)-COALESCE(SUM(l.credit),0))::text FROM "JournalLine" l WHERE l."accountId"=a."glAccountId") gl
    FROM "CashAccount" a
    UNION ALL
    SELECT 'bank', b."currentBalance"::text,
    (SELECT (COALESCE(SUM(l.debit),0)-COALESCE(SUM(l.credit),0))::text FROM "JournalLine" l WHERE l."accountId"=b."glAccountId")
    FROM "BankAccount" b`);
  R("treasury_gl_projection_after_ops", tr.rows.every(r => r.bal === r.gl), tr.rows);
}

await db.end();
const fails = Object.entries(out).filter(([, v]) => !v.ok);
console.log(fails.length ? `SMOKE_FAILED (${fails.length})` : "SMOKE_ALL_PASSED");
process.exit(fails.length ? 1 : 0);
