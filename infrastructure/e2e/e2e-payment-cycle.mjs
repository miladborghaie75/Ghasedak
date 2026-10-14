/**
 * E2E Payment Cycle Test — چرخهٔ کامل پرداخت (سفارش مهمان → start → verify → PAID)
 * ============================================================================
 * با provider فعلیِ API کار می‌کند: اگر Merchant زرین‌پال ست باشد سندباکس واقعی،
 * وگرنه mock داخلی (فقط dev). هر دو مسیر یک چرخهٔ واحد را می‌سنجند.
 *
 * گام‌ها:
 *   1) GET  /api/v1/shipping/methods        → اولین روش فعال
 *   2) GET  /api/v1/catalog/products        → اولین واریانت در-stock
 *   3) POST /api/v1/orders/checkout         → سفارش مهمان (idempotent)
 *   4) POST /api/v1/payments/start          → attempt + redirectUrl
 *   5) POST /api/v1/payments/callback/mock  → شبیه‌سازی بازگشت از درگاه (Status=OK)
 *   6) POST /api/v1/payments/verify/:auth   → PAID + refId + orderCode
 *   7) اثبات DB (اگر --db داده شود):
 *        Order.PAID / PaymentAttempt.PAID+refId / StockLedgerEntry SALE /
 *        JournalEntry سند فروش (1100/4000) / DomainEventOutbox OrderPaid
 *
 * استفاده:
 *   node e2e-payment-cycle.mjs --base http://127.0.0.1:4100 \
 *        --db "postgresql://postgres:rehearsal-pw@127.0.0.1:55433/p11dev"
 *        [--seed-stock]  اگر واریانت انتخابی موجودی دفتری صفر داشته باشد،
 *                        یک ردیف OPENING درج می‌کند (فقط روی DB تستی!)
 *
 * نکتهٔ انتخاب واریانت: با --db موجودی از StockLedgerEntry در انبارِ کانال
 * "website" خوانده می‌شود (همان چیزی که checkout واقعاً رزرو می‌کند)؛ SKUهای
 * تستی TST-* که دفتر موجودی ندارند نادیده گرفته می‌شوند.
 */
import { createRequire } from "node:module";

const args = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const BASE = args("base", "http://127.0.0.1:4100").replace(/\/$/, "");
const DB_URL = args("db", "");
const SEED_STOCK = process.argv.includes("--seed-stock");

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const j = async (res) => {
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(`HTTP ${res.status} → ${typeof body === "string" ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
  return body;
};

async function main() {
  log(`E2E payment cycle → base=${BASE} db=${DB_URL ? "assert" : "api-only"}`);

  // 1) روش ارسال
  const ship = await j(await fetch(`${BASE}/api/v1/shipping/methods`));
  const method = (ship.items ?? ship)[0];
  if (!method?.id) throw new Error("هیچ روش ارسالی فعال نیست");
  log(`shipping: ${method.name ?? method.id}`);

  // 2) واریانت با موجودی دفتریِ واقعی (همان رزروی که checkout می‌کند)
  const cat = await j(await fetch(`${BASE}/api/v1/catalog/products?per_page=50`));
  const products = cat.items ?? cat;
  const apiStock = new Map();
  for (const p of products) for (const v of p.variants ?? []) {
    if (v.sku && !v.sku.startsWith("TST-")) apiStock.set(v.sku, v.stock ?? 0);
  }
  if (apiStock.size === 0) throw new Error("هیچ واریانت غیرتستی یافت نشد");

  let ledger = new Map();
  let pg = null;
  if (DB_URL) {
    const req = createRequire("C:/ghasedak-tools/pg-client/package.json");
    const { Client } = req("pg");
    pg = new Client({ connectionString: DB_URL });
    await pg.connect();
    const q = async (sql, vals = []) => (await pg.query(sql, vals)).rows;
    const [ch] = await q(`SELECT "defaultWarehouseId" FROM "SalesChannel" WHERE slug = 'website' AND active`);
    if (ch) {
      const rows = await q(
        `SELECT l."variantSku", SUM(l."qtyIn" - l."qtyOut")::int AS bal
           FROM "StockLedgerEntry" l
          WHERE l."warehouseId" = $1 AND l."variantSku" = ANY($2)
          GROUP BY 1`,
        [ch.defaultWarehouseId, [...apiStock.keys()]],
      );
      ledger = new Map(rows.map((r) => [r.variantSku, Number(r.bal)]));
    }
  }
  let sku = null;
  let best = -1;
  for (const [s, apiSt] of apiStock) {
    const bal = ledger.has(s) ? ledger.get(s) : apiSt; // بدون DB: فیلد API
    if (bal > best) { best = bal; sku = s; }
  }
  if (!sku || best < 1) throw new Error("هیچ واریانت با موجودی دفتری مثبت یافت نشد (از --seed-stock استفاده کنید)");
  log(`variant: ${sku} (ledger/api balance=${best})`);

  // کمبود موجودی → OPENING (فقط با --seed-stock و روی DB تستی)
  const NEED = 1;
  if (DB_URL && best < NEED) {
    if (!SEED_STOCK) throw new Error(`موجودی ${sku} ناکافی است (${best}); با --seed-stock دوباره اجرا کنید`);
    const [wh] = await pg.query(`SELECT "defaultWarehouseId" FROM "SalesChannel" WHERE slug = 'website' AND active`).then((r) => r.rows);
    const key = `e2e-opening-${Date.now()}`;
    await pg.query(
      `INSERT INTO "StockLedgerEntry"
         (id, "warehouseId", "variantSku", type, "qtyIn", "qtyOut", "balanceBefore", "balanceAfter",
          "refType", "idempotencyKey", note, "createdAt")
       VALUES (md5(random()::text || clock_timestamp()::text), $1, $2, 'OPENING', $3, 0, $4, $5,
               'opening', $6, 'E2E seed stock', now())`,
      [wh.defaultWarehouseId, sku, NEED, best, best + NEED, key],
    );
    best += NEED;
    log(`seed-stock: OPENING +${NEED} برای ${sku} (balance=${best}) key=${key}`);
  }
  if (pg) await pg.end();

  // 3) سفارش مهمان
  const stamp = Date.now();
  const order = await j(await fetch(`${BASE}/api/v1/orders/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      guestName: "تست E2E پرداخت",
      guestMobile: "09120000001",
      address: { province: "تهران", city: "تهران", address: "خیابان تست اتوماسیون", plaque: "۱", postalCode: "1111111111" },
      shippingMethodId: method.id,
      lines: [{ sku, qty: 1 }],
      idempotencyKey: `e2e-order-${stamp}`,
    }),
  }));
  if (!order.id || !order.code) throw new Error(`پاسخ سفارش ناقص: ${JSON.stringify(order).slice(0, 300)}`);
  log(`order: ${order.code} total=${order.total}`);

  // idempotency سفارش — درخواست تکراری باید همان سفارش را بدهد
  const order2 = await j(await fetch(`${BASE}/api/v1/orders/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      guestName: "تست E2E پرداخت", guestMobile: "09120000001",
      address: { province: "تهران", city: "تهران", address: "خیابان تست اتوماسیون", plaque: "۱", postalCode: "1111111111" },
      shippingMethodId: method.id, lines: [{ sku, qty: 1 }], idempotencyKey: `e2e-order-${stamp}`,
    }),
  }));
  if (order2.id !== order.id) throw new Error(`idempotency سفارش شکست: ${order2.id} ≠ ${order.id}`);
  log("order idempotency: OK");

  // 4) شروع پرداخت
  const pay = await j(await fetch(`${BASE}/api/v1/payments/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // گام F0-5: آدرس بازگشت باید نسبی (یا روی دامنهٔ مجاز) باشد — دامنهٔ
    // هاردکد‌شده فقط وابستگی به پورت/محیط می‌سازد و حالا رد می‌شود.
    body: JSON.stringify({ orderId: order.id, idempotencyKey: `e2e-pay-${stamp}`, callbackUrl: "/api/pay/callback" }),
  }));
  if (!pay.attemptId || !pay.redirectUrl) throw new Error(`پاسخ start ناقص: ${JSON.stringify(pay).slice(0, 300)}`);
  const authority = new URL(pay.redirectUrl, BASE).searchParams.get("authority") ?? new URL(pay.redirectUrl, BASE).pathname.split("/").pop();
  log(`payment started: attempt=${pay.attemptId} authority=${authority} redirect=${pay.redirectUrl.slice(0, 90)}`);

  // 5) بازگشت از درگاه — mock همانند زرین‌پال به callback برمی‌گردد (Status=OK)
  //    (callback هرگز تایید نیست؛ فقط ثبت است — verify سمت‌سرور جداگانه می‌آید)
  const cb = await j(await fetch(`${BASE}/api/v1/payments/callback/mock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ authority, status: "OK" }),
  }));
  if (!cb.ok) throw new Error(`callback نپذیرفت: ${JSON.stringify(cb)}`);
  log(`gateway callback: OK (authority=${authority.slice(0, 24)}…)`);

  // 6) verify سمت‌سرور — تنها مرجع تایید (idempotent؛ حتی بعد از auto-verify callback)
  const ver = await j(await fetch(`${BASE}/api/v1/payments/verify/${encodeURIComponent(authority)}`, { method: "POST" }));
  if (ver.state !== "PAID") throw new Error(`verify PAID نشد: ${JSON.stringify(ver).slice(0, 300)}`);
  log(`verified: PAID refId=${ver.refId} orderCode=${ver.orderCode ?? order.code}`);
  if (ver.orderCode && ver.orderCode !== order.code) throw new Error(`orderCode ناهم‌خوان: ${ver.orderCode} ≠ ${order.code}`);

  // 6) اثبات DB
  if (DB_URL) {
    const req = createRequire("C:/ghasedak-tools/pg-client/package.json");
    const { Client } = req("pg");
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    const q = async (sql, vals = []) => (await c.query(sql, vals)).rows;
    try {
      const [ord] = await q(`SELECT id, "paymentStatus", status FROM "Order" WHERE code = $1`, [order.code]);
      if (!ord) throw new Error("سفارش در DB یافت نشد");
      if (ord.paymentStatus !== "PAID" || ord.status !== "PAID") throw new Error(`وضعیت سفارش: ${ord.paymentStatus}/${ord.status}`);
      const [att] = await q(`SELECT state, "providerTxId" FROM "PaymentAttempt" WHERE id = $1`, [pay.attemptId]);
      if (!att || att.state !== "PAID") throw new Error(`attempt: ${att?.state ?? "missing"}`);
      if (!String(att.providerTxId ?? "").startsWith("MOCKRF") && !att.providerTxId) throw new Error("refId در attempt ثبت نشده");
      const sale = await q(
        `SELECT COUNT(*)::int AS n FROM "StockLedgerEntry" WHERE "refId" = $1 AND type = 'SALE'`,
        [ord.id],
      );
      if (Number(sale[0].n) < 1) throw new Error("حرکت SALE ثبت نشده");
      const [je] = await q(
        `SELECT je.number FROM "JournalEntry" je WHERE je."sourceType" = 'order' AND je."sourceId" = $1`,
        [ord.id],
      );
      if (!je) throw new Error("سند فروش (JournalEntry) ثبت نشده");
      const ev = await q(`SELECT COUNT(*)::int AS n FROM "DomainEventOutbox" WHERE name = 'OrderPaid' AND payload->>'orderId' = $1`, [ord.id]);
      if (Number(ev[0].n) < 1) throw new Error("رویداد OrderPaid در outbox نیست");
      log(`DB asserts: Order.PAID ✓ attempt.PAID(${att.providerTxId}) ✓ SALE ✓ سند ${je.number} ✓ OrderPaid.outbox ✓`);
    } finally {
      await c.end();
    }
  }

  log("E2E_PAYMENT_CYCLE_PASSED ✅");
}

main().catch((e) => {
  console.error("E2E_PAYMENT_CYCLE_FAILED:", e.message);
  process.exit(1);
});
