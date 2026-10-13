/** بررسی سرتاسری رهگیری مرسوله — از تحویل به پست تا نمایش در فروشگاه. */
const API = "http://localhost:4000/api/v1";
const SITE = "http://localhost:3111";
/** کد یکتا در هر اجرا — وگرنه اجرای دوم به‌خاطر کد تکراری رد می‌شود */
const TCODE = `TRK-TEST-${Date.now()}`;
let cookie = "";
let pass = 0,
  fail = 0;
const ok = (l, x = "") => { console.log(`  PASS  ${l}${x ? " — " + x : ""}`); pass++; };
const bad = (l, x = "") => { console.log(`  FAIL  ${l}${x ? " — " + x : ""}`); fail++; };
const step = (n, t) => console.log(`\n${n}) ${t}`);

async function req(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json; charset=utf-8" } : {}),
      ...(cookie ? { cookie } : {}),
    },
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const kv = c.split(";")[0];
    if (kv.startsWith("ghasedak_admin_session=")) cookie = kv;
  }
  const t = await res.text();
  try { return { status: res.status, json: JSON.parse(t), text: t }; } catch { return { status: res.status, json: null, text: t }; }
}

(async () => {
  step(1, "ورود ادمین");
  {
    const r = await req(`${API}/auth/login`, { method: "POST", body: JSON.stringify({ email: "admin@ghasedak.demo", password: "Ghasedak#Demo1" }) });
    r.status === 200 && cookie ? ok("نشست برقرار شد") : bad("ورود", `status=${r.status}`);
  }

  step(2, "یک سفارش پرداخت‌شده پیدا کن");
  let order = null;
  {
    const r = await req(`${API}/orders`);
    const items = r.json?.items ?? [];
    order = items.find((o) => o.paymentStatus === "PAID") ?? null;
    order ? ok("سفارش پرداخت‌شده یافت شد", `code=${order.code} status=${order.status}`) : bad("سفارش پرداخت‌شده نیست — با اسکریپت نمی‌توان تست کرد");
    if (!order) { console.log("\nنتیجه: ناتمام — دادهٔ لازم نبود"); process.exit(1); }
  }

  const orderBefore = order.status;

  step(3, "ساخت مرسوله");
  let shipmentId = null;
  {
    const r = await req(`${API}/shipping/shipments`, { method: "POST", body: JSON.stringify({ orderId: order.id }) });
    if (r.status === 201 && r.json?.id) { shipmentId = r.json.id; ok("مرسوله ساخته شد", `id=${shipmentId}`); }
    else { bad("ساخت مرسوله", `status=${r.status} ${r.text.slice(0, 140)}`); process.exit(1); }
  }

  step(4, "قبل از تحویل به پست: کد رهگیری وجود ندارد");
  {
    const r = await req(`${API}/shipping/track/${encodeURIComponent(order.code)}`);
    r.json?.found === true && r.json.trackingCode === null
      ? ok("مرسوله پیدا شد ولی هنوز کد رهگیری ندارد", `state=${r.json.state}`)
      : bad("وضعیت اولیه", JSON.stringify(r.json).slice(0, 160));
  }

  step(5, "ثبت کد رهگیری (تحویل به پست)");
  {
    const code = TCODE;
    const r = await req(`${API}/shipping/shipments/${shipmentId}/label`, { method: "POST", body: JSON.stringify({ provider: "post", trackingCode: code }) });
    r.status === 201 || r.status === 200 ? ok("کد رهگیری ثبت شد", `code=${code}`) : bad("ثبت کد", `status=${r.status} ${r.text.slice(0, 140)}`);
  }

  step(6, "سفارش باید «بسته‌بندی شده» (PACKED) شود");
  {
    const r = await req(`${API}/orders`);
    const o = (r.json?.items ?? []).find((x) => x.id === order.id);
    o?.status === "PACKED" ? ok("وضعیت سفارش = PACKED (بسته‌بندی شده)") : bad("وضعیت سفارش", `expected PACKED got ${o?.status}`);
    o?.trackingCode === TCODE ? ok("کد رهگیری روی سفارش کپی شد") : bad("trackingCode روی سفارش", `got ${o?.trackingCode}`);
  }

  step(7, "کد تکراری باید رد شود");
  {
    const r = await req(`${API}/shipping/shipments`, { method: "POST", body: JSON.stringify({ orderId: order.id }) });
    if (r.status === 201 && r.json?.id) {
      const d = await req(`${API}/shipping/shipments/${r.json.id}/label`, { method: "POST", body: JSON.stringify({ provider: "post", trackingCode: TCODE }) });
      d.status === 400 ? ok("کد رهگیری تکراری رد شد (۴۰۰)") : bad("کد تکراری پذیرفته شد", `status=${d.status}`);
    } else bad("ساخت مرسوله دوم ناموفق", `status=${r.status}`);
  }

  step(8, "رهگیری با کد پستی");
  {
    const r = await req(`${API}/shipping/track/${TCODE}`);
    r.json?.found === true && r.json.state === "LABEL_CREATED" && r.json.provider === "پست پیشتاز"
      ? ok("با کد پستی پیدا شد", `state=${r.json.stateLabel} provider=${r.json.provider}`)
      : bad("رهگیری با کد پستی", JSON.stringify(r.json).slice(0, 160));
  }

  step(9, "رهگیری با کد سفارش هم کار کند");
  {
    const r = await req(`${API}/shipping/track/${encodeURIComponent(order.code)}`);
    r.json?.found === true && r.json.trackingCode === TCODE
      ? ok("با کد سفارش هم پیدا شد") : bad("رهگیری با کد سفارش", JSON.stringify(r.json).slice(0, 160));
  }

  step(10, "خط زمانی مرحله‌ها را نشان دهد");
  {
    const r = await req(`${API}/shipping/track/${TCODE}`);
    const ev = r.json?.events ?? [];
    ev.length >= 4 ? ok("خط زمانی ساخته شد", `${ev.length} مرحله`) : bad("خط زمانی", `only ${ev.length}`);
    const done = ev.filter((e) => e.at != null).map((e) => e.label);
    done.includes("سفارش ثبت شده") && done.includes("بسته‌بندی شده")
      ? ok("مراحل طی‌شده علامت خورده‌اند", done.join(" ← ")) : bad("مراحل طی‌شده", done.join(","));
  }

  step(11, "تحویل به پست → «ارسال شده» و سفارش SHIPPED");
  {
    await req(`${API}/shipping/shipments/${shipmentId}/status`, { method: "POST", body: JSON.stringify({ status: "IN_TRANSIT" }) });
    const r = await req(`${API}/shipping/track/${TCODE}`);
    r.json?.state === "IN_TRANSIT" && r.json.shippedAt
      ? ok("وضعیت = ارسال شد", `shippedAt=${r.json.shippedAt.slice(0, 19)}`) : bad("وضعیت ارسال", JSON.stringify(r.json).slice(0, 140));
    const o = (await req(`${API}/orders`)).json?.items?.find((x) => x.id === order.id);
    o?.status === "SHIPPED" ? ok("سفارش = SHIPPED (هم‌گام شد)") : bad("سفارش", `got ${o?.status}`);
  }

  step(12, "تحویل گیرنده");
  {
    await req(`${API}/shipping/shipments/${shipmentId}/status`, { method: "POST", body: JSON.stringify({ status: "DELIVERED" }) });
    const r = await req(`${API}/shipping/track/${TCODE}`);
    r.json?.state === "DELIVERED" && r.json.deliveredAt ? ok("وضعیت = تحویل داده شد") : bad("وضعیت تحویل", JSON.stringify(r.json).slice(0, 140));
    const o = (await req(`${API}/orders`)).json?.items?.find((x) => x.id === order.id);
    o?.status === "DELIVERED" ? ok("سفارش = DELIVERED") : bad("سفارش", `got ${o?.status}`);
  }

  step(13, "گذار غیرمجاز باید رد شود");
  {
    const r = await req(`${API}/shipping/shipments/${shipmentId}/status`, { method: "POST", body: JSON.stringify({ status: "IN_TRANSIT" }) });
    r.status === 400 ? ok("گذار از وضعیت نهایی رد شد (۴۰۰)") : bad("گذار غیرمجاز پذیرفته شد", `status=${r.status}`);
  }

  step(14, "کد ناموجود → ۴۰۴");
  {
    const r = await req(`${API}/shipping/track/NO-SUCH-CODE-999`);
    r.status === 404 ? ok("۴۰۴ برگشت") : bad("کد ناموجود", `status=${r.status}`);
  }

  step(15, "صفحهٔ /track در فروشگاه");
  {
    const h = await fetch(`${SITE}/track`);
    const html = await h.text();
    h.status === 200 ? ok("/track → ۲۰۰") : bad("/track", `status=${h.status}`);
    html.includes("پیگیری مرسوله") ? ok("عنوان درست") : bad("محتوای صفحه");
    html.includes('name="code"') ? ok("فرم ورودی کد دارد") : bad("فرم ورودی کد ندارد");
  }

  step(16, "نتیجه در صفحهٔ فروشگاه واقعاً نمایش داده شود");
  {
    const h = await fetch(`${SITE}/track?code=${TCODE}`);
    const html = await h.text();
    html.includes(TCODE) ? ok("کد رهگیری در صفحهٔ رهگیری دیده می‌شود") : bad("کد در صفحهٔ /track دیده نشد");
    html.includes("تحویل داده شد") ? ok("وضعیت «تحویل داده شد» نمایش داده شد") : bad("وضعیت نمایش داده نشد");
  }

  step(17, "صفحهٔ سفارش، کد پستی را نشان دهد");
  {
    const h = await fetch(`${SITE}/order/${encodeURIComponent(order.code)}`);
    const html = await h.text();
    h.status === 200 ? ok("/order/[code] → ۲۰۰") : bad("/order", `status=${h.status}`);
    html.includes(TCODE) ? ok("کد رهگیری پستی در صفحهٔ سفارش دیده می‌شود") : bad("کد پستی در صفحهٔ سفارش نیست");
  }

  step(18, "لینک پیگیری در فوتر و صفحهٔ ارسال");
  {
    const h = await (await fetch(`${SITE}/`)).text();
    h.includes('href="/track"') ? ok("لینک /track در فوتر هست") : bad("لینک فوتر");
    const s = await (await fetch(`${SITE}/shipping`)).text();
    s.includes('/track') ? ok("لینک پیگیری در صفحهٔ ارسال هست") : bad("لینک صفحهٔ ارسال");
  }

  step(19, "کد خالی");
  {
    const r = await req(`${API}/shipping/track/%20`);
    r.status === 400 ? ok("کد خالی → ۴۰۰") : bad("کد خالی", `status=${r.status}`);
  }

  step(20, "پاک‌سازی خودکار دادهٔ تست");
  {
    const { execFileSync } = await import("node:child_process");
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient();
    const rows = await db.shipment.findMany({ where: { trackingCode: { startsWith: "TRK-TEST-" } }, select: { id: true, orderId: true } });
    const orderIds = [...new Set(rows.map((s) => s.orderId))];
    if (rows.length) await db.shipment.deleteMany({ where: { id: { in: rows.map((s) => s.id) } } });
    for (const id of orderIds) {
      const o = await db.order.findUnique({ where: { id }, select: { paymentStatus: true, trackingCode: true } });
      if (!o) continue;
      await db.order.update({
        where: { id },
        data: {
          status: o.paymentStatus === "PAID" ? "PAID" : "PENDING",
          trackingCode: o.trackingCode?.startsWith("TRK-TEST-") ? null : o.trackingCode,
        },
      });
    }
    const left = await db.shipment.count({ where: { trackingCode: { startsWith: "TRK-TEST-" } } });
    await db.$disconnect();
    void execFileSync;
    left === 0 ? ok("همهٔ دادهٔ تست پاک شد", `${rows.length} مرسوله، ${orderIds.length} سفارش بازگردانده شد`) : bad("دادهٔ تست باقی ماند", `${left}`);
  }

  console.log(`\n${"=".repeat(52)}`);
  console.log(`نتیجه: ${pass} موفق / ${fail} ناموفق`);
  console.log("=".repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("خطا:", e.message); process.exit(1); });