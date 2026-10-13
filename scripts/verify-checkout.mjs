/**
 * تست یکپارچهٔ مسیر خرید آنلاین — فاز ۵ (تست دائمی)
 *
 * پوشش کامل زنجیرهٔ خرید:
 *   صفحهٔ فروشگاه (کوکی CSRF/سبد) → سبد سروری → کد تخفیف (سهمیه) → ثبت سفارش
 *   → رزرو انبار → idempotency (دوبار کلیک) → سهمیهٔ مشتری → فروش بیشتر از موجودی
 *   → اعتبارسنجی آدرس → پیگیری با کد → لغو و آزادسازی رزرو → پاکسازی کامل
 *   → توازن دفتر به حالت قبل
 *
 * اجرا: node scripts/verify-checkout.mjs
 * پیش‌نیاز: API روی :4000 و فروشگاه روی :3111 (و دیتابیس)
 */
import http from "node:http";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const API = "http://localhost:4000";
const SITE = "http://localhost:3111";
const STAMP = Date.now();
const IDEM_MAIN = `chk-${STAMP}-main`;
const MOBILE_A = "09120004401";
const MOBILE_B = "09120004402";
const testSku = `CHK-${STAMP}`;
const couponCode = "CHK" + STAMP;

let pass = 0, fail = 0;
const ok = (t, d = "") => { pass++; console.log(`PASS  ${t}${d ? " — " + d : ""}`); };
const bad = (t, d = "") => { fail++; console.log(`FAIL  ${t}${d ? " — " + d : ""}`); };
const eq = (t, actual, expected, extra = "") =>
  actual === expected ? ok(t, extra) : bad(t, `انتظار ${expected}، واقعی ${actual} ${extra}`);

function req(url, opts = {}) {
  return new Promise((r) => {
    const u = new URL(url);
    const q = http.request(
      { host: u.hostname, port: u.port, path: u.pathname + u.search, method: opts.method ?? "GET", headers: { "content-type": "application/json", ...(opts.headers ?? {}) } },
      (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => r({ s: res.statusCode, d, h: res.headers })); },
    );
    q.on("error", (e) => r({ s: 0, d: e.message, h: {} }));
    q.end(opts.body || "");
  });
}
const cookieOf = (res, name) => ((res.h["set-cookie"] || []).map((c) => c.match(new RegExp(name + "=([^;]+)"))).find(Boolean) || [])[1] ?? "";

const makeBody = (mobile, idem, { qty = 1, coupon = couponCode, province = "تهران", city = "تهران" } = {}) =>
  JSON.stringify({
    guestName: "تست خرید آنلاین", guestMobile: mobile,
    address: { province, city, address: "خیابان تست", plaque: "۱", postalCode: "1234567890" },
    shippingMethodId: method.id, couponCode: coupon, lines: [{ sku: testSku, qty }], idempotencyKey: idem,
  });
const checkoutApi = (mobile, idem, opt = {}) => req(`${API}/api/v1/orders/checkout`, { method: "POST", body: makeBody(mobile, idem, opt) });
const checkoutSite = (idem, opt = {}) => req(`${SITE}/api/checkout`, { method: "POST", headers: { cookie: cookies, "x-csrf-token": csrf, "x-idempotency-key": idem }, body: makeBody(MOBILE_A, idem, opt) });

// ───────────────── ۰) ماندهٔ دفتر قبل از تست (برای چک بازگشت در پایان) ─────────────────
const aggBefore = await db.journalLine.aggregate({ _sum: { debit: true, credit: true } });
const drBefore = (aggBefore._sum.debit ?? 0n).toString();

// ───────────────── ۱) ورود ادمین + آماده‌سازی داده ─────────────────
const login = await req(`${API}/api/v1/auth/login`, { method: "POST", body: JSON.stringify({ email: "admin@ghasedak.demo", password: "Ghasedak#Demo1" }) });
const adminCookie = (login.h["set-cookie"] || []).map((c) => c.split(";")[0]).join("; ");
login.s === 200 || login.s === 201 ? ok("ورود ادمین") : bad("ورود ادمین", `status=${login.s}`);

const cats = JSON.parse((await req(`${API}/api/v1/admin/catalog/categories`, { headers: { cookie: adminCookie } })).d || "{}");
const categoryId = Array.isArray(cats) ? cats[0]?.id : cats.items?.[0]?.id;
const method = await db.shippingMethod.findFirst({ where: { status: "active" } });

const prodRes = await req(`${API}/api/v1/admin/products`, {
  method: "POST", headers: { cookie: adminCookie },
  body: JSON.stringify({ name: "تست خرید آنلاین " + STAMP, categoryId, basePrice: 500000, variants: [{ sku: testSku, price: 500000, stockQty: 10 }] }),
});
prodRes.s === 201 ? ok("محصول تستی با موجودی ۱۰ ساخته شد", testSku) : bad("محصول تستی", `status=${prodRes.s} ${prodRes.d.slice(0, 140)}`);

// کد تخفیف ثابت ۱۰۰٬۰۰۰ با سهمیهٔ ۱ برای هر مشتری
await db.coupon.create({ data: { code: couponCode, type: "fixed", amount: 100000n, perCustomerLimit: 1, active: true } });

// ───────────────── ۲) صفحهٔ فروشگاه → کوکیهای CSRF و سبد ─────────────────
const page = await req(`${SITE}/`);
const csrf = cookieOf(page, "csrf_token");
const cartToken = cookieOf(page, "cart_token");
(page.s === 200 && csrf && cartToken) ? ok("کوکیهای CSRF و سبد از صفحهٔ فروشگاه") : bad("کوکیهای فروشگاه", `page=${page.s} csrf=${!!csrf} cart=${!!cartToken}`);
const cookies = `csrf_token=${csrf}; cart_token=${cartToken}`;

// ───────────────── ۳) سبد سروری: افزودن، خواندن، تغییر تعداد ─────────────────
const add = JSON.parse((await req(`${SITE}/api/cart/items`, { method: "POST", headers: { cookie: cookies }, body: JSON.stringify({ variantId: testSku, qty: 2 }) })).d || "{}");
add.count === 2 ? ok("افزودن به سبد سروری (qty=2)") : bad("افزودن به سبد", JSON.stringify(add).slice(0, 100));

const cartRead = JSON.parse((await req(`${SITE}/api/cart`, { headers: { cookie: cookies } })).d || "{}");
(cartRead.lines?.[0]?.variantId === testSku && cartRead.lines?.[0]?.qty === 2) ? ok("خواندن سبد — قلم و تعداد درست") : bad("خواندن سبد", JSON.stringify(cartRead).slice(0, 100));

const setQty = JSON.parse((await req(`${SITE}/api/cart/items`, { method: "POST", headers: { cookie: cookies }, body: JSON.stringify({ variantId: testSku, qty: 1 }) })).d || "{}");
setQty.count === 1 ? ok("تغییر تعداد در سبد (qty=1)") : bad("تغییر تعداد", JSON.stringify(setQty).slice(0, 100));

// ───────────────── ۴) کد تخفیف — پیشنمایش صادقانه ─────────────────
const quote = JSON.parse((await req(`${API}/api/v1/orders/quote/coupon?code=${couponCode}&subtotal=500000&mobile=${MOBILE_A}`)).d || "{}");
(quote.valid === true && quote.discount === 100000) ? ok("پیشنمایش کد تخفیف — ۱۰۰٬۰۰۰") : bad("پیشنمایش تخفیف", JSON.stringify(quote));

// ───────────────── ۵) ثبت سفارش از پراکسی فروشگاه (مسیر واقعی کاربر) ─────────────────
const expectedTotal = 500000 - 100000 + Number(method.cost);
const co1 = await checkoutSite(IDEM_MAIN);
const co1Body = JSON.parse(co1.d || "{}");
((co1.s === 201 || co1.s === 200) && co1Body.orderCode) ? ok("ثبت سفارش (پراکسی + CSRF)", co1Body.orderCode) : bad("ثبت سفارش", `status=${co1.s} ${co1.d.slice(0, 150)}`);
eq("مبلغ کل = قیمت − تخفیف + ارسال", Number(co1Body.total), expectedTotal);

// ───────────────── ۶) رزرو انبار ─────────────────
const orderRow = await db.order.findFirst({ where: { idempotencyKey: IDEM_MAIN }, include: { items: true } });
const reservation = orderRow ? await db.stockReservation.findFirst({ where: { refType: "order", refId: orderRow.id, state: "ACTIVE" } }) : null;
(orderRow && reservation && reservation.variantSku === testSku && Number(reservation.qty) === 1)
  ? ok("رزرو انبار ACTIVE با تعداد درست") : bad("رزرو انبار", JSON.stringify(reservation ?? null).slice(0, 120));

// ───────────────── ۷) idempotency — دوبار کلیک ─────────────────
const co2 = await checkoutSite(IDEM_MAIN);
const co2Body = JSON.parse(co2.d || "{}");
co2Body.orderCode === co1Body.orderCode ? ok("idempotency — همان کلید، همان سفارش") : bad("idempotency", `${co1Body.orderCode} vs ${co2Body.orderCode}`);
eq("فقط یک سفارش با این کلید", await db.order.count({ where: { idempotencyKey: IDEM_MAIN } }), 1);

// ───────────────── ۸) سهمیهٔ مشتری (perCustomerLimit=1) ─────────────────
const co3 = await checkoutApi(MOBILE_A, `chk-quota-${STAMP}`);
co3.s === 400 ? ok("سهمیهٔ کد تخفیف — استفادهٔ دوم رد شد", JSON.parse(co3.d || "{}")?.message ?? "") : bad("سهمیهٔ مشتری", `status=${co3.s} ${co3.d.slice(0, 100)}`);

// ───────────────── ۹) فروش بیشتر از موجودی ─────────────────
const oversell = await checkoutApi(MOBILE_B, `chk-over-${STAMP}`, { qty: 99, coupon: null });
oversell.s === 400 ? ok("فروش بیشتر از موجودی رد شد") : bad("فروش بیش از موجودی", `status=${oversell.s} ${oversell.d.slice(0, 100)}`);

// ───────────────── ۱۰) اعتبارسنجی آدرس ─────────────────
const fakeCity = await checkoutApi(MOBILE_B, `chk-geocity-${STAMP}`, { coupon: null, city: "شهرخیالی" });
fakeCity.s === 400 ? ok("شهر جعلی رد شد", JSON.parse(fakeCity.d || "{}")?.message ?? "") : bad("شهر جعلی", `status=${fakeCity.s}`);
const fakeProv = await checkoutApi(MOBILE_B, `chk-geoprov-${STAMP}`, { coupon: null, province: "استانخیالی", city: "شهرخیالی" });
fakeProv.s === 400 ? ok("استان جعلی رد شد", JSON.parse(fakeProv.d || "{}")?.message ?? "") : bad("استان جعلی", `status=${fakeProv.s}`);

// ───────────────── ۱۱) پیگیری سفارش با کد ─────────────────
const byCode = JSON.parse((await req(`${API}/api/v1/orders/by-code/${co1Body.orderCode}`)).d || "{}");
byCode?.code === co1Body.orderCode && byCode?.items?.length === 1 ? ok("پیگیری سفارش با کد + اقلام") : bad("پیگیری با کد", JSON.stringify(byCode).slice(0, 100));

// ───────────────── ۱۲) لغو سفارش و آزادسازی رزرو ─────────────────
const cancel = await req(`${API}/api/v1/orders/${orderRow.id}/cancel`, { method: "POST", headers: { cookie: adminCookie } });
(cancel.s === 200 || cancel.s === 201) ? ok("لغو سفارش توسط ادمین") : bad("لغو سفارش", `status=${cancel.s} ${cancel.d.slice(0, 100)}`);
const cancelled = await db.order.findUnique({ where: { id: orderRow.id }, select: { status: true } });
cancelled?.status === "CANCELLED" ? ok("وضعیت سفارش CANCELLED") : bad("وضعیت پس از لغو", JSON.stringify(cancelled));
const released = await db.stockReservation.findFirst({ where: { refType: "order", refId: orderRow.id } });
released?.state === "RELEASED" ? ok("رزرو پس از لغو آزاد شد") : bad("آزادسازی رزرو", JSON.stringify(released ?? null));

// ───────────────── ۱۳) پاکسازی کامل دادههای تست (ترتیب وابستگی) ─────────────────
const testOrders = await db.order.findMany({ where: { idempotencyKey: { startsWith: `chk-${STAMP}` } }, select: { id: true } });
for (const o of testOrders) {
  await db.couponRedemption.deleteMany({ where: { orderId: o.id } });
  await db.stockReservation.deleteMany({ where: { refType: "order", refId: o.id } });
  await db.orderItem.deleteMany({ where: { orderId: o.id } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: o.id } });
  await db.order.delete({ where: { id: o.id } });
}
const coupon = await db.coupon.findUnique({ where: { code: couponCode } });
if (coupon) await db.coupon.delete({ where: { id: coupon.id } });
await db.stockLedgerEntry.deleteMany({ where: { variantSku: testSku } });
await db.costLayer.deleteMany({ where: { variantSku: testSku } });
await db.variantPrice.deleteMany({ where: { variantSku: testSku } });
// قلمهای سبد سروری — FK به واریانت دارد؛ باید قبل از حذف واریانت پاک شود
await db.cartItem.deleteMany({ where: { variant: { sku: testSku } } });
const pRow = await db.product.findFirst({ where: { name: { contains: "تست خرید آنلاین " + STAMP } }, select: { id: true } });
if (pRow) {
  const entries = await db.journalEntry.findMany({ where: { sourceType: "opening_inventory", sourceId: pRow.id }, select: { id: true } });
  for (const e of entries) {
    await db.journalLine.deleteMany({ where: { entryId: e.id } });
    await db.journalEntry.delete({ where: { id: e.id } });
  }
  await db.productVariant.deleteMany({ where: { sku: testSku } });
  await db.product.deleteMany({ where: { id: pRow.id } });
}
const leftOrder = await db.order.count({ where: { idempotencyKey: { startsWith: `chk-${STAMP}` } } });
const leftVariant = await db.productVariant.count({ where: { sku: testSku } });
(leftOrder === 0 && leftVariant === 0) ? ok("پاکسازی کامل دادههای تست") : bad("پاکسازی", `orders=${leftOrder} variants=${leftVariant}`);

// ───────────────── ۱۴) توازن دفتر به حالت قبل برگشت ─────────────────
const aggAfter = await db.journalLine.aggregate({ _sum: { debit: true, credit: true } });
const drAfter = (aggAfter._sum.debit ?? 0n).toString();
eq("توازن دفتر به حالت قبل برگشت", drAfter, drBefore);

console.log(`\nنتیجهٔ تست خرید آنلاین: ${pass} موفق / ${fail} ناموفق`);
await db.$disconnect();
process.exit(fail > 0 ? 1 : 0);
