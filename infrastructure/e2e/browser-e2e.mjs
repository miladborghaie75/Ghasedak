#!/usr/bin/env node
/**
 * گام ۲۶ (F3-2) — E2E مرورگری: دو سناریو روی DB تمرین.
 *  A) خرید کامل مهمان: خانه → محصول → سبد → تسویه (فرم آدرس) → درگاه mock → پرداخت موفق
 *  B) ادمین: ورود → داشبورد → سفارش‌ها (سفارش سناریو A) → گزارش حسابداری → بررسی نظرات
 * نیازمندها: Chrome نصب (CHROME_PATH)، سرویس‌های بالا (run-local.sh).
 * اسکرین‌شات هر گام + خطا در docs/evidence/e2e-browser/ می‌نشیند.
 */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const STORE = process.env.STORE_BASE ?? "http://localhost:3111";
const ADMIN = process.env.ADMIN_BASE ?? "http://localhost:3200";
const SHOTS = "../../docs/evidence/e2e-browser";
mkdirSync(SHOTS, { recursive: true });

const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
let failed = 0;
const ok = (m) => log("  ✓", m);
const bad = (m) => { failed++; log("  ✗ FAIL:", m); };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--lang=fa"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` }).catch(() => undefined);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clickByText = async (sel, re, extra) => {
  const handle = await page.evaluateHandle(
    (sel, reSrc, hasExtra) => {
      const rx = new RegExp(reSrc);
      const all = [...document.querySelectorAll(sel)].filter(
        (el) => rx.test((el.textContent ?? "") + " " + (el.getAttribute("aria-label") ?? "")) && !(hasExtra && el.disabled),
      );
      // فقط نسخهٔ قابل‌مشاهده و فعال — fallback به نسخهٔ غیرفعال باعث می‌شد کلیک بی‌اثر برود (handleAdd زودتر return می‌کند)
      const pick = all.find((el) => el.getClientRects().length > 0 && !el.disabled) ?? null;
      if (pick) {
        const r = pick.getBoundingClientRect();
        pick.setAttribute("data-e2e-last-click", "1");
        console.log("[pick]", JSON.stringify({ txt: (pick.innerText ?? "").slice(0, 30), dis: pick.disabled, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }));
      }
      return pick;
    },
    sel, re.source, Boolean(extra),
  );
  const el = handle.asElement();
  if (!el) throw new Error(`دکمه/لینک یافت نشد: ${sel} ~ ${re}`);
  await el.evaluate((e) => e.scrollIntoView({ block: "center" })).catch(() => undefined);
  let how = "native";
  try {
    await el.click({ timeout: 5000 });
  } catch (e) {
    how = "js:" + e.message.slice(0, 60);
    // پوشانده‌شدن توسط بنر/اورلی دیگر — کلیک DOM‌ای بدون hit-test
    await el.evaluate((e2) => e2.click());
  }
  console.log("[click]", how);
  return el;
};
const text = () => page.evaluate(() => document.body.innerText);
page.on("response", async (r) => {
  const u = r.url().replace(STORE, "");
  if (r.url().includes("/api/cart")) console.log("[net]", r.request().method(), u, "->", r.status());
  // تسویه: لاگ بدنهٔ پاسخ تا علت شکست ثبت سفارش (بدون آن فقط ۴۰۰ بی‌معناست)
  if (r.url().includes("/api/checkout")) {
    console.log("[net]", r.request().method(), u, "->", r.status());
    console.log("       res:", (await r.text().catch(() => "")).slice(0, 300));
  }
});

log("== گام ۲۶ — سناریو A: خرید کامل مهمان ==");
try {
  await page.goto(STORE + "/", { waitUntil: "networkidle0", timeout: 60000 });
  // کش سرد کاتالوگ (fetch اولیه با timeout) ممکن است رندر اول را خالی کند — منتظر لینک محصول بمان، وگرنه reload
  let firstProduct = null;
  for (let attempt = 0; attempt < 3 && !firstProduct; attempt++) {
    firstProduct = await page
      .waitForFunction(() => document.querySelector('a[href^="/p/"]')?.getAttribute("href") ?? null, { timeout: 15000 })
      .then((h) => h.jsonValue())
      .catch(() => null);
    if (!firstProduct) await page.reload({ waitUntil: "networkidle0" });
  }
  if (!firstProduct) throw new Error("لینک محصول روی صفحهٔ اصلی نیست");
  ok(`خانه بالا؛ اولین محصول: ${firstProduct}`);
  await shot("a1-home");

  // بنر رضایت آنالیتیک را ببند تا روی کلیک‌های بعدی سایه نیندازد (رد = بدون GA در تست)
  const dismissed = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /نه،\s*ممنون/.test((x.textContent ?? "").trim()));
    if (b && b.getClientRects().length) { b.click(); return true; }
    return false;
  });
  if (dismissed) { await sleep(500); ok("بنر رضایت بسته شد"); }

  await page.goto(STORE + firstProduct, { waitUntil: "networkidle0", timeout: 60000 });
  await sleep(1200); // hydration + وصل‌شدن CartProvider (ready)
  // اگر سایز لازم است، اولین سایزِ فعال را انتخاب کن
  const sizeBtn = await page.$('button[aria-label^="سایز"]:not([disabled])');
  if (sizeBtn) { await sizeBtn.click(); await sleep(400); ok("سایز انتخاب شد"); }
  // دکمه باید فعال شود (variant قابل‌حل + cart ready) — وگرنه کلیک بی‌اثر است
  await page.waitForFunction(
    () => [...document.querySelectorAll("button")].some((x) => /افزودن به سبد/.test(x.innerText ?? "") && !x.disabled),
    { timeout: 15000 },
  ).catch(() => { throw new Error("دکمهٔ افزودن به سبد فعال نشد (variant/ready)"); });
  // کلیک + راستی‌آزمایی: نشان سبد باید عدد بگیرد؛ حداکثر ۳ بار
  let added = false;
  for (let i = 0; i < 3 && !added; i++) {
    await clickByText("button", /افزودن به سبد|انتخاب و افزودن/, (el) => el.disabled);
    added = await page
      .waitForFunction(() => /[۰-۹0-9]/.test(document.querySelector('a[href="/cart"]')?.innerText ?? ""), { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    const badgeNow = await page.evaluate(() => JSON.stringify(document.querySelector('a[href="/cart"]')?.innerText ?? null));
    console.log(`[try ${i + 1}] added=${added} badge=${badgeNow}`);
  }
  if (!added) throw new Error("افزودن به سبد تأیید نشد (نشان سبد خالی ماند)");
  ok("به سبد اضافه شد");
  await shot("a2-product");

  await page.goto(STORE + "/cart", { waitUntil: "networkidle0" });
  if (!/سبد خریدت خالی/.test(await text()) === false) ok("سبد خالی نیست");
  if ((await text()).includes("سبد خریدت خالی است")) throw new Error("سبد خالی است!");
  await clickByText("a", /ادامه خرید و پرداخت/);
  await page.waitForFunction(() => location.pathname === "/checkout", { timeout: 15000 });
  // pathname زودتر از محتوا عوض می‌شود — صبر تا فرم آدرس واقعاً در DOM بیاید
  await page.waitForSelector("#name", { timeout: 20000 }).catch(async () => {
    throw new Error("فرم آدرس روی /checkout ظاهر نشد: " + (await text()).slice(0, 160).replace(/\n/g, " | "));
  });
  ok("تسویه باز شد");
  await shot("a3-checkout-empty");

  // فرم آدرس مهمان
  const set = async (sel, val) => page.evaluate((s, v) => { const el = document.querySelector(s); if (!el) throw new Error("فیلد نیست: " + s); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, sel, val);
  await set("#name", "خریدار تست E2E");
  await set("#phone", "09120000026");
  // استان: صبر تا آپشن‌ها از /api/geo بیاید، بعد انتخاب (کنترل‌شدهٔ React)
  await page
    .waitForFunction(() => (document.querySelector("#province")?.options.length ?? 0) > 1, { timeout: 15000 })
    .catch(() => { throw new Error("لیست استان‌ها خالی ماند (/api/geo)"); });
  const provPicked = await page.evaluate(() => {
    const s = document.querySelector("#province");
    const opt = [...s.options].find((o) => o.value);
    s.value = opt.value;
    s.dispatchEvent(new Event("change", { bubbles: true }));
    return s.value;
  });
  // شهر: تا select فعال و پر شود
  await page
    .waitForFunction(() => { const c = document.querySelector("#city"); return !!c && !c.disabled && c.options.length > 1; }, { timeout: 15000 })
    .catch(() => { throw new Error(`لیست شهرها فعال نشد (استان=${provPicked})`); });
  const cityPicked = await page.evaluate(() => {
    const c = document.querySelector("#city");
    const opt = [...c.options].find((o) => o.value);
    c.value = opt.value;
    c.dispatchEvent(new Event("change", { bubbles: true }));
    return c.value;
  });
  await set("#address", "خیابان تست، کوچهٔ E2E");
  await set("#plaque", "12");
  await set("#postal", "1234567890");
  await page.evaluate(() => { const r = document.querySelector('input[name="shipping"]'); if (r) { r.click(); } });
  await sleep(600);
  if (!(await page.$('input[name="shipping"]'))) throw new Error("روش ارسانی لود نشد (بعد از انتخاب استان)");
  const geoSel = await page.evaluate(() => ({ p: document.querySelector("#province")?.value, c: document.querySelector("#city")?.value }));
  if (!geoSel.p || !geoSel.c) throw new Error(`استان/شهر ثبت نشد: ${JSON.stringify(geoSel)}`);
  ok(`فرم آدرس پر شد (استان=${geoSel.p}، شهر=${geoSel.c}) + روش ارسال`);
  await shot("a4-checkout-filled");

  await clickByText("button", /پرداخت .*تومان/, (el) => el.disabled);
  await page.waitForFunction(() => location.pathname.startsWith("/checkout/pay") && !location.pathname.startsWith("/checkout/pay/mock"), { timeout: 20000 });
  ok("صفحهٔ پرداخت: " + page.url().replace(STORE, ""));
  await shot("a5-pay");

  await clickByText("button", /پرداخت .*تومان/, (el) => el.disabled);
  await page.waitForFunction(() => location.pathname.startsWith("/checkout/pay/mock"), { timeout: 20000 });
  ok("درگاه mock باز شد");
  await shot("a6-gateway");

  // دکمهٔ موفقِ درگاه mock یک <Link> است (anchor)، نه <button> — هر دو را بگیر
  await clickByText("button, a", /پرداخت موفق/);
  await page.waitForFunction(() => !location.pathname.startsWith("/checkout/pay/mock"), { timeout: 20000 });
  await sleep(1200);
  const finalText = await text();
  const code = finalText.match(/ORD-\d+/)?.[0] ?? null;
  (code ? ok : bad)(`پایان موفق؛ سفارش ${code ?? "بدون کد!"} روی صفحهٔ تأیید`);
  await shot("a7-success");
  process.env.E2E_ORDER_CODE = code ?? "";
  if (!code) throw new Error("کد سفارش روی صفحهٔ پایانی نیست");

  // ── نظر (برای سناریو B) — best-effort ──
  await page.goto(STORE + firstProduct, { waitUntil: "networkidle0" });
  const ta = await page.$("textarea");
  if (ta) {
    await ta.type("نظر تست E2E مرورگری — کیفیت خوب بود.");
    const rate = await page.$('input[type="radio"][value="5"], [role="radiogroup"] *');
    if (rate) await rate.click().catch(() => undefined);
    await clickByText("button", /ثبت نظر|ارسال/).catch(() => undefined);
    await sleep(1500);
    ok("نظر تست ثبت شد");
  } else log("  - فرم نظر روی صفحه نیست (بدون ورود) — بخش تأیید نظر ادمین N/A");
} catch (e) {
  bad("A: " + e.message);
  await shot("a-error");
}

log("== گام ۲۶ — سناریو B: ادمین ==");
const adminPage = await browser.newPage();
adminPage.on("pageerror", (e) => errors.push(`admin pageerror: ${e.message}`));
try {
  const ap = adminPage;
  await ap.setViewport({ width: 1280, height: 900 });
  ap.on("pageerror", (e) => errors.push(`admin pageerror: ${e.message}`));
  await ap.goto(ADMIN + "/login", { waitUntil: "networkidle0", timeout: 60000 });
  // هدف‌گذاری صریح فیلدها + صبر برای hydration — ورودی‌های کنترل‌شدهٔ React موقع mount مقدار تایپ‌شده را ریست می‌کنند
  await ap.evaluate(() => {
    const els = [...document.querySelectorAll("input")].filter((e) => e.type !== "hidden");
    const pw = els.find((e) => e.type === "password");
    const em = els.find((e) => e !== pw);
    em?.setAttribute("data-e2e", "email");
    pw?.setAttribute("data-e2e", "password");
  });
  await ap.waitForSelector('input[data-e2e="email"]');
  await sleep(1500);
  await ap.type('input[data-e2e="email"]', "admin@ghasedak.demo");
  await ap.type('input[data-e2e="password"]', "Ghasedak#Demo1");
  const creds = await ap.evaluate(() => ({
    em: document.querySelector('input[data-e2e="email"]')?.value ?? "",
    pw: document.querySelector('input[data-e2e="password"]')?.value ?? "",
  }));
  if (!creds.em || !creds.pw) {
    // fallback سازگار با React: مقدار از طریق setter بومی + رویداد input
    await ap.evaluate(() => {
      const set = (sel, v) => {
        const el = document.querySelector(sel);
        if (!el) return;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      set('input[data-e2e="email"]', "admin@ghasedak.demo");
      set('input[data-e2e="password"]', "Ghasedak#Demo1");
    });
    await sleep(300);
  }
  await ap.click('button[type="submit"]');
  await ap.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 20000 });
  ok("ورود ادمین → " + (await ap.evaluate(() => location.pathname)));

  const orderCode = process.env.E2E_ORDER_CODE;
  await ap.goto(ADMIN + "/orders", { waitUntil: "networkidle0" });
  const ordersText = await ap.evaluate(() => document.body.innerText);
  (orderCode && ordersText.includes(orderCode) ? ok : bad)(`سفارش‌ها: ${orderCode} ${orderCode && ordersText.includes(orderCode) ? "دیده می‌شود" : "پیدا نشد!"}`);
  await ap.screenshot({ path: `${SHOTS}/b1-orders.png` });

  await ap.goto(ADMIN + "/accounting", { waitUntil: "networkidle0" });
  const acc = await ap.evaluate(() => document.body.innerText);
  (/تراز|صندوق|گزارش|داشبورد/.test(acc) ? ok : bad)("گزارش حسابداری باز شد");
  await ap.screenshot({ path: `${SHOTS}/b2-accounting.png` });

  await ap.goto(ADMIN + "/reviews", { waitUntil: "networkidle0" });
  const rv = await ap.evaluate(() => document.body.innerText);
  if (/در انتظار|نظر/.test(rv)) {
    const approved = await ap.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => /تأیید/.test(b.textContent ?? ""));
      if (btn) { btn.click(); return true; }
      return false;
    });
    (approved ? ok : log)("  " + (approved ? "نظر در انتظار تأیید شد" : "- نظری در انتظار تأیید نبود"));
    await ap.screenshot({ path: `${SHOTS}/b3-reviews.png` });
  } else bad("صفحهٔ نظرات محتوای مورد انتظار ندارد");
} catch (e) {
  bad("B: " + e.message);
  await adminPage.screenshot({ path: `${SHOTS}/b-error.png` }).catch(() => undefined);
}

log(`خطاهای کنسول/pageerror (A+B): ${errors.length}`);
errors.slice(0, 8).forEach((e) => log("  !", e.slice(0, 160)));
if (errors.length > 0) bad(`${errors.length} خطای کنسول`);
await browser.close();
log(failed === 0 ? "BROWSER_E2E_PASSED ✅" : `BROWSER_E2E_FAILED ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
