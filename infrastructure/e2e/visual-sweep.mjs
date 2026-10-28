#!/usr/bin/env node
/**
 * گام ۲۸ (F3-4) — چک‌لیست تصویری سراسری: ماتریس صفحه × تم × viewport.
 *
 * هر صفحه در دو تم (light/dark) و سه viewport (موبایل/تبلت/دسکتاپ) باز می‌شود؛
 * برای هر ترکیب: خطای کنسول/pageerror ثبت و اسکرین‌شات گرفته می‌شود.
 * خروجی: docs/evidence/visual-sweep/*.png + visual-sweep.md (ماتریس) + visual-sweep.json.
 *
 * استفاده: CHROME_PATH=... node visual-sweep.mjs
 * پیش‌نیاز: فروشگاه :3111، ادمین :3200 بالا (run-local.sh).
 */
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const STORE = process.env.STORE_BASE ?? "http://localhost:3111";
const ADMIN = process.env.ADMIN_BASE ?? "http://localhost:3200";
const OUT = "../../docs/evidence/visual-sweep";
mkdirSync(OUT, { recursive: true });

const THEMES = ["light", "dark"];
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844, deviceScaleFactor: 2, isMobile: true },
  { name: "tablet", width: 768, height: 1024, deviceScaleFactor: 2 },
  { name: "desktop", width: 1280, height: 900, deviceScaleFactor: 1 },
];

/** صفحات فروشگاه — مسیرهای پارامتری با فیکسچر واقعی DB تمرین پر می‌شوند */
const storePages = [
  ["/", "home"],
  ["/search?q=سوتین", "search"],
  ["/c/bra", "category"],
  ["/p/tst-Lmvpkxsq5", "product"],
  ["/cart", "cart"],
  ["/checkout", "checkout"],
  ["/wishlist", "wishlist"],
  ["/need", "need"],
  ["/about", "about"],
  ["/contact", "contact"],
  ["/terms", "terms"],
  ["/privacy", "privacy"],
  ["/returns", "returns"],
  ["/shipping", "shipping"],
  ["/track", "track"],
  ["/order/ORD-000018", "order"],
];

/** صفحات ادمین (بعد از ورود) — صفحات ورود/بازیابی جدا ثبت می‌شوند */
const adminPages = [
  ["/", "dashboard"],
  ["/orders", "orders"],
  ["/products", "products"],
  ["/inventory", "inventory"],
  ["/inventory/reports", "inventory-reports"],
  ["/accounting", "accounting"],
  ["/accounting/journal", "journal"],
  ["/customers", "customers"],
  ["/payments", "payments"],
  ["/pos", "pos"],
  ["/reports", "reports"],
  ["/marketing", "marketing"],
  ["/media", "media"],
  ["/builder", "builder"],
  ["/photography", "photography"],
  ["/settings/capabilities", "capabilities"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
let shots = 0;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--lang=fa"] });

async function sweep(base, pages, label, opts = {}) {
  const ctx = await browser.createBrowserContext(); // کوکی تمیز برای هر اپ
  const page = await ctx.newPage();
  const errors = [];

  if (opts.login) {
    await page.setViewport({ ...VIEWPORTS[2] });
    await page.goto(`${ADMIN}/login`, { waitUntil: "networkidle0", timeout: 60000 });
    await sleep(1200);
    await page.evaluate(() => {
      const els = [...document.querySelectorAll("input")].filter((e) => e.type !== "hidden");
      const pw = els.find((e) => e.type === "password");
      const em = els.find((e) => e !== pw);
      const set = (el, v) => {
        if (!el) return;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      set(em, "admin@ghasedak.demo");
      set(pw, "Ghasedak#Demo1");
    });
    await page.click('button[type="submit"]').catch(() => undefined);
    await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => undefined);
    await sleep(800);
  }

  // خطاهای کنسول در هر صفحه پاک می‌شود تا مالکِ صفحه مشخص شود
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

  for (const [path, name] of pages) {
    for (const vp of VIEWPORTS) {
      await page.setViewport({ ...vp });
      for (const theme of THEMES) {
        errors.length = 0;
        await page.evaluateOnNewDocument((t, k) => {
          try { localStorage.setItem(k, t); } catch {}
        }, theme, opts.themeKey ?? "ghasedak-theme");
        try {
          await page.goto(base + path, { waitUntil: "networkidle0", timeout: 60000 });
          await sleep(600);
        } catch (e) {
          errors.push(`navigation: ${e.message.slice(0, 120)}`);
        }
        const applied = await page.evaluate(() => document.documentElement.getAttribute("data-theme")).catch(() => null);
        const themeOk = applied === theme;
        const file = `${label}-${name}-${theme}-${vp.name}.png`;
        await page.screenshot({ path: `${OUT}/${file}` }).catch(() => undefined);
        shots++;
        rows.push({ app: label, page: path, name, theme, viewport: vp.name, themeOk, errors: [...errors] });
        const mark = errors.length === 0 && themeOk ? "✓" : "✗";
        console.log(`${mark} ${label} ${path} [${theme}/${vp.name}]${themeOk ? "" : ` (تم=${applied})`}${errors.length ? ` — ${errors.length} خطا: ${errors[0].slice(0, 90)}` : ""}`);
      }
    }
  }
  await ctx.close();
}

console.log("== گام ۲۸ — ماتریس تصویری فروشگاه ==");
await sweep(STORE, storePages, "store");
console.log("== گام ۲۸ — ماتریس تصویری ادمین ==");
await sweep(ADMIN, adminPages, "admin", { login: true, themeKey: "ghasedak-admin-theme" });

await browser.close();

const bad = rows.filter((r) => r.errors.length > 0 || !r.roleOk && !r.themeOk);
const errRows = rows.filter((r) => r.errors.length > 0);
const themeRows = rows.filter((r) => !r.themeOk);
writeFileSync(`${OUT}/visual-sweep.json`, JSON.stringify({ generatedAt: new Date().toISOString(), total: rows.length, withErrors: errRows.length, themeMismatches: themeRows.length, rows }, null, 2));

const md = [
  "# چک‌لیست تصویری سراسری (گام ۲۸)",
  "",
  `- تاریخ اجرا: ${new Date().toISOString()}`,
  `- ترکیب‌ها: ${rows.length} (صفحه × تم × viewport) · اسکرین‌شات‌ها: ${OUT}/*.png`,
  `- صفحه با خطا: ${errRows.length} · ناهمخوانی تم: ${themeRows.length}`,
  "",
  "| اپ | صفحه | تم | viewport | تم اعمال شد | خطای کنسول |",
  "|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.app} | \`${r.page}\` | ${r.theme} | ${r.viewport} | ${r.themeOk ? "✅" : "❌"} | ${r.errors.length ? "❌ " + r.errors[0].slice(0, 60).replace(/\|/g, "/") : "✅"} |`),
  "",
].join("\n");
writeFileSync(`${OUT}/visual-sweep.md`, md);

console.log(`\nکل: ${rows.length} ترکیب، ${shots} اسکرین‌شات، ${errRows.length} صفحه با خطای کنسول، ${themeRows.length} ناهمخوانی تم`);
process.exit(errRows.length === 0 && themeRows.length === 0 ? 0 : 1);
