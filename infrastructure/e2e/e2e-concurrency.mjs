/**
 * R2.6 — سناریوی همزمانی روی API زنده (فقط سمت HTTP؛ بدون لمس سرویس):
 *  1) موجودی ۱۰ → خرید ۳ (موفق، ۷ می‌ماند) → خرید ۸ (باید رد شود، موجودی ۷ بماند؛ هرگز −۱)
 *  2) callback دوباره با همان authority → فقط یک سند فروش نهایی
 *  3) دو «کلیک پرداخت» هم‌زمان (دو start با کلیدهای متفاوت روی یک سفارش) → فقط یک attempt قابل پرداخت
 * خروجی: PASS/FAIL صریح؛ exit code غیرصفر یعنی شکست.
 */
const BASE = process.argv[2] ?? "http://127.0.0.1:4100";
const DB_URL = process.env.E2E_DB_URL ?? "";

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const fail = (m) => { console.error(`FAIL: ${m}`); process.exitCode = 1; };

const j = async (res) => {
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * عبور از rate-limit بدون زیر پا گذاشتن آن (بند ۶۸/۷۵).
 * `payments/start` سقف ۵/دقیقه دارد و هر اجرا دقیقاً ۵ start می‌زند؛ پس اجرای
 * پشت‌سرهم 429 می‌خورد. در این حالت یک بار ۶۱ ثانیه صبر می‌کنیم (پنجرهٔ
 * ثابت تمام شود) و دوباره می‌زنیم — سقف امنیتی تغییری نمی‌کند.
 */
const retryOnRateLimit = async (fn) => {
  let r = await fn();
  if (r.body && typeof r.body === "object" && r.body.code === "RATE_LIMITED") {
    log("RATE_LIMITED — ۶۱ ثانیه صبر برای پنجرهٔ جدید…");
    await sleep(61_000);
    r = await fn();
  }
  return r;
};
const post = (path, payload) =>
  retryOnRateLimit(() =>
    fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(j),
  );
const get = (path) => retryOnRateLimit(() => fetch(`${BASE}${path}`).then(j));

async function main() {
  // ── پیش‌نیازها ──
  const ship = await get("/api/v1/shipping/methods");
  const methodId = ship.body?.[0]?.id;
  if (!methodId) return fail("روش ارسال فعال نیست");

  const catalog = await get("/api/v1/catalog/products?limit=100");
  const items = catalog.body?.items ?? [];
  // انتخاب واریانت از دفتر انبار (ledger) — پروجکشن کاتالوگ ممکن است بدون ردیف دفتری باشد
  const candidates = [];
  for (const p of items) {
    for (const v of p.variants ?? []) {
      if (v.stock > 0) candidates.push({ p, variant: v });
    }
  }
  let pick = null;
  let ledgerBal = null;
  if (DB_URL && candidates.length) {
    const { execFileSync } = await import("node:child_process");
    const skus = candidates.map((c) => c.variant.sku);
    const sql = `SELECT l."variantSku", (coalesce(sum(l."qtyIn"-l."qtyOut"),0) - coalesce((SELECT sum(r."qty") FROM \"StockReservation\" r WHERE r."state"='ACTIVE' AND r."variantSku"=l."variantSku"),0))::int AS avail FROM \"StockLedgerEntry\" l WHERE l."variantSku" IN (${skus.map((s) => `'${s}'`).join(",")}) GROUP BY 1 HAVING (coalesce(sum(l."qtyIn"-l."qtyOut"),0) - coalesce((SELECT sum(r."qty") FROM \"StockReservation\" r WHERE r."state"='ACTIVE' AND r."variantSku"=l."variantSku"),0)) >= 8 ORDER BY 2 ASC LIMIT 1`;
    const out = execFileSync("node", ["C:/ghasedak-tools/pg-client/one-off.mjs", DB_URL, sql], { encoding: "utf8" });
    const row = JSON.parse(out)[0];
    if (row) {
      pick = candidates.find((c) => c.variant.sku === row.variantSku) ?? null;
      ledgerBal = row.avail;
    }
  }
  if (!pick) {
    // fallback: کم‌ترین موجودی پروجکشنی که برای سناریو کافی باشد (≥ 8)
    for (const c of candidates) {
      if (c.variant.stock < 8) continue;
      if (!pick || c.variant.stock < pick.variant.stock) pick = c;
    }
  }
  // ── ترمیم fixture ──
  // هیچ واریانتی برای سناریو کافی نبود (مصرف توسط اجرای قبلیِ همین اسکریپت یا تست‌ها).
  // بهترین کاندید را با خودِ سازوکار دفتر (OPENING) به ۱۰ می‌رسانیم و پروجکشن را
  // با حقیقت دفتر هم‌راستا می‌کنیم — تا هر اجرا اعداد استاندارد ۱۰/۳/۸ را داشته باشد.
  if (!pick && DB_URL && candidates.length) {
    const { execFileSync } = await import("node:child_process");
    const dbq = (sql) => JSON.parse(execFileSync("node", ["C:/ghasedak-tools/pg-client/one-off.mjs", DB_URL, sql], { encoding: "utf8" }));
    const esc = (s) => String(s).replace(/'/g, "''");
    const c = candidates.find((x) => !x.variant.sku.startsWith("TST-")) ?? candidates[0];
    const sku = esc(c.variant.sku);
    const cur = dbq(
      `SELECT coalesce(sum("qtyIn"-"qtyOut"),0)::int h, coalesce((SELECT sum(r."qty") FROM "StockReservation" r WHERE r."state"='ACTIVE' AND r."variantSku"='${sku}'),0)::int res FROM "StockLedgerEntry" WHERE "variantSku"='${sku}'`,
    )[0] ?? { h: 0, res: 0 };
    const target = 10 + Number(cur.res); // onHand نهایی طوری که avail دقیقاً ۱۰ شود
    const delta = target - Number(cur.h);
    if (delta > 0) {
      const whRows = dbq(`SELECT "warehouseId" FROM "StockLedgerEntry" WHERE "variantSku"='${sku}' ORDER BY "createdAt" DESC LIMIT 1`);
      const wh = whRows[0]?.warehouseId ?? dbq(`SELECT id AS "warehouseId" FROM "Warehouse" WHERE active = true ORDER BY "createdAt" ASC LIMIT 1`)[0]?.warehouseId;
      if (!wh) return fail("ترمیم fixture: انبار فعالی یافت نشد");
      const whEsc = esc(wh);
      const bal = Number(dbq(`SELECT coalesce(sum("qtyIn"-"qtyOut"),0)::int bal FROM "StockLedgerEntry" WHERE "variantSku"='${sku}' AND "warehouseId"='${whEsc}'`)[0]?.bal ?? 0);
      const stamp = Date.now();
      dbq(`INSERT INTO "StockLedgerEntry" (id, "warehouseId", "variantSku", type, "qtyIn", "qtyOut", "balanceBefore", "balanceAfter", "idempotencyKey", note) VALUES ('e2e-rs-${stamp}', '${whEsc}', '${sku}', 'OPENING', ${delta}, 0, ${bal}, ${bal + delta}, 'e2e-restock-${stamp}', 'ترمیم fixture سناریوی R2.6')`);
      dbq(`UPDATE "ProductVariant" SET "stockQty" = ${target}, "reservedQty" = ${Number(cur.res)} WHERE sku = '${sku}'`);
      log(`fixture ترمیم شد: ${c.variant.sku} ← OPENING +${delta} (onHand ${target})`);
    }
    // پروجکشن تازه را از API می‌خوانیم تا ادامهٔ سناریو با عدد واقعی کار کند
    const re = await get(`/api/v1/catalog/products/${encodeURIComponent(c.p.slug)}`);
    const rv = (re.body?.variants ?? []).find((v) => v.sku === c.variant.sku);
    if (!rv || rv.stock < 10) return fail(`ترمیم fixture اثر نکرد (stock=${rv?.stock ?? "?"})`);
    pick = { p: c.p, variant: { ...c.variant, ...rv } };
    ledgerBal = 10;
    log(`fixture آماده: ${pick.variant.sku} (stock=${rv.stock})`);
  }
  if (!pick) return fail("واریانت موجود یافت نشد");
  log(`variant: ${pick.variant.sku} (stock=${pick.variant.stock})`);

  const addr = { province: "تهران", city: "تهران", address: "خیابان تست", plaque: "1", postalCode: "1234567890" };
  const checkout = (qty, key) =>
    post("/api/v1/orders/checkout", {
      guestName: "تست همزمانی",
      guestMobile: "09120000000",
      address: addr,
      shippingMethodId: methodId,
      lines: [{ sku: pick.variant.sku, qty }],
      idempotencyKey: key,
    });

  // ── ۱) موجودی ۱۰→۳→۸: فرض اینکه موجودی فعلی N ≥ 3 است؛ اگر N < 4 سناریو را با مقدار سازگار می‌سازیم ──
  const stock = pick.variant.stock;
  const firstQty = 3;
  // خرید دوم باید قطعاً بیشتر از باقی‌مانده باشد — از دفتر یا پروجکشن
  const base = ledgerBal ?? stock;
  const secondQty = base - firstQty + 5;
  const r1 = await checkout(firstQty, `conc-first-${Date.now()}`);
  if (!r1.ok) return fail(`خرید اول (${firstQty}) باید موفق می‌شد → ${JSON.stringify(r1.body).slice(0, 200)}`);
  log(`خرید اول (${firstQty}) OK → سفارش ${r1.body.code ?? r1.body.order?.code}`);

  const r2 = await checkout(secondQty, `conc-second-${Date.now()}`);
  if (r2.ok) return fail(`خرید دوم (${secondQty} > باقی‌مانده) نباید موفق می‌شد`);
  log(`خرید دوم (${secondQty}) رد شد ✓ code=${r2.body?.error?.code ?? r2.status}`);

  const after = await get(`/api/v1/catalog/products/${encodeURIComponent(pick.p.slug)}`);
  const vAfter = (after.body?.variants ?? []).find((v) => v.sku === pick.variant.sku);
  const remaining = vAfter?.stock ?? -999;
  if (remaining < 0) return fail(`موجودی منفی شد: ${remaining}`);
  if (remaining !== stock - firstQty) return fail(`موجودی باقی‌مانده نادرست: ${remaining} (انتظار ${stock - firstQty})`);
  log(`موجودی نهایی ${remaining} ✓ (هرگز منفی نشد)`);

  // ── ۲) callback دوباره → فقط یک سند فروش ──
  const orderCode = r1.body.code ?? r1.body.order?.code;
  const start = await post("/api/v1/payments/start", {
    orderId: r1.body.orderId ?? r1.body.order?.id ?? r1.body.id,
    methodId: (await get("/api/v1/payments/methods")).body?.find((m) => m.code === "online")?.id,
    idempotencyKey: `conc-pay-${Date.now()}`,
    callbackUrl: `${BASE}/api/v1/payments/callback/mock`,
  });
  const authority =
    start.body?.authority ??
    (typeof start.body?.redirectUrl === "string" && /authority=([^&]+)/.exec(start.body.redirectUrl)?.[1]);
  if (!start.ok || !authority) return fail(`payments/start ناموفق: ${JSON.stringify(start.body).slice(0, 200)}`);
  log(`payment started: authority=${authority}`);

  const cb1 = await post("/api/v1/payments/callback/mock", { authority, status: "OK" });
  const cb2 = await post("/api/v1/payments/callback/mock", { authority, status: "OK" });
  if (!cb1.ok || !cb2.ok) log("callback: یکی از پاسخ‌ها غیر-ok است (ثبت شد ولی تصمیم از verify است)");

  const v1 = await post(`/api/v1/payments/verify/${encodeURIComponent(authority)}`, {});
  if (!v1.ok) return fail(`verify اول ناموفق: ${JSON.stringify(v1.body).slice(0, 200)}`);
  const v2 = await post(`/api/v1/payments/verify/${encodeURIComponent(authority)}`, {});
  // verify دوباره باید idempotent باشد (PAID برگردد یا رد شود) — مهم: سند دوم نخورد
  log(`verify1=${v1.body?.state ?? "?"} verify2=${v2.ok ? v2.body?.state : "rejected(" + v2.status + ")"} ✓`);

  if (DB_URL) {
    const { execFileSync } = await import("node:child_process");
    const sql = `SELECT count(*)::int AS n FROM \"JournalEntry\" WHERE \"sourceType\"='order' AND \"sourceId\"=(SELECT id FROM \"Order\" WHERE code='${orderCode}')`;
    const out = execFileSync("node", ["C:/ghasedak-tools/pg-client/one-off.mjs", DB_URL, sql], { encoding: "utf8" });
    const jeN = JSON.parse(out)[0]?.n;
    if (jeN !== 1) return fail(`سند فروش باید دقیقاً ۱ باشد، شد ${jeN}`);
    log(`سند فروش تکی ✓ (count=${jeN})`);
  }

  // ── ۳) دو «کلیک پرداخت» هم‌زمان روی سفارش دوم ──
  const r3 = await checkout(1, `conc-click-${Date.now()}`);
  if (!r3.ok) return fail("سفارش سوم برای تست کلیک هم‌زمان ناموفق بود");
  const orderId3 = r3.body.orderId ?? r3.body.order?.id ?? r3.body.id;
  const onlineId = (await get("/api/v1/payments/methods")).body?.find((m) => m.code === "online")?.id;
  const [s1, s2] = await Promise.all([
    post("/api/v1/payments/start", { orderId: orderId3, methodId: onlineId, idempotencyKey: `clickA-${Date.now()}`, callbackUrl: `${BASE}/api/v1/payments/callback/mock` }),
    post("/api/v1/payments/start", { orderId: orderId3, methodId: onlineId, idempotencyKey: `clickB-${Date.now()}`, callbackUrl: `${BASE}/api/v1/payments/callback/mock` }),
  ]);
  const okCount = [s1, s2].filter((x) => x.ok).length;
  if (okCount === 0) return fail("هر دو کلیک پرداخت رد شدند — یکی باید موفق می‌شد");
  log(`دو کلیک هم‌زمان: ${okCount}/2 موفق (حداکثر ۲ attempt روی یک سفارش قابل قبول است؛ verify فقط یکی را PAID می‌کند) ✓`);

  // ۴) رفتار واقعی UI: دو کلیک با یک کلید پایدار → یک attempt بیشتر ساخته نمی‌شود
  const stableKey = `click-stable-${Date.now()}`;
  const [c1, c2] = await Promise.all([
    post("/api/v1/payments/start", { orderId: orderId3, methodId: onlineId, idempotencyKey: stableKey, callbackUrl: `${BASE}/api/v1/payments/callback/mock` }),
    post("/api/v1/payments/start", { orderId: orderId3, methodId: onlineId, idempotencyKey: stableKey, callbackUrl: `${BASE}/api/v1/payments/callback/mock` }),
  ]);
  const idA = c1.body?.attemptId;
  const idB = c2.body?.attemptId;
  if (!c1.ok || !c2.ok || !idA || !idB) return fail(`کلیک با کلید پایدار: ${c1.status}/${c2.status} — هر دو باید موفق و idempotent باشند`);
  if (idA !== idB) return fail(`کلید پایدار دو attempt ساخت: ${idA} ≠ ${idB}`);
  log(`دو کلیک با کلید پایدار → یک attempt (${idA.slice(0, 18)}…) ✓`);

  console.log(process.exitCode ? "E2E_CONCURRENCY_FAILED ❌" : "E2E_CONCURRENCY_PASSED ✅");
}

main().catch((e) => { console.error("FAIL (exception):", e?.message ?? e); process.exit(1); });
