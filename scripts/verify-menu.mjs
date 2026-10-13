/**
 * تست منوی ادمین — فاز ۳
 *
 * دو چیز را می‌سنجد:
 *  ۱) همهٔ صفحه‌های واقعی ادمین در منو لینک دارند (هیچ‌کدام جا نمی‌مانند)
 *  ۲) کارهای مالی در یک گروه واحد جمع شده‌اند و ساختار درست است
 */
import fs from "node:fs";
import path from "node:path";

// ریشهٔ پروژه: اسکریپت ممکن است از ریشه یا از داخل apps/api اجرا شود
const ROOT =
  process.cwd().endsWith("apps\\api") || process.cwd().endsWith("apps/api")
    ? path.resolve(process.cwd(), "..", "..")
    : process.cwd();
const APP = path.join(ROOT, "apps", "admin", "app");

let pass = 0, fail = 0;
const ok = (l, x = "") => {
  console.log(`  PASS  ${l}${x ? " — " + x : ""}`);
  pass++;
};
const bad = (l, x = "") => {
  console.log(`  FAIL  ${l}${x ? " — " + x : ""}`);
  fail++;
};

/** همهٔ مسیرهای صفحهٔ ادمین (پارامترهای داینامیک → [x]) */
function findPages(dir, base = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findPages(full, `${base}/${entry.name}`));
      continue;
    }
    if (entry.name === "page.tsx") {
      out.push(base === "" ? "/" : base);
    }
  }
  return out;
}

// ── منو را از فایل TypeScript می‌خوانیم (بدون نیاز به build)
const menuSrc = fs.readFileSync(path.join(ROOT, "apps", "admin", "lib", "menu.ts"), "utf8");

const hrefs = new Set();
for (const m of menuSrc.matchAll(/href:\s*"([^"]+)"/g)) hrefs.add(m[1]);

console.log(`\n۱) پوشش منو — ${hrefs.size} لینک در منو\n`);
const pages = findPages(APP);
console.log(`  صفحه‌های موجود: ${pages.length}`);

/**
 * صفحه‌هایی که عمداً در منو نیستند.
 *
 * «جزئی» یعنی صفحه‌ای که کاربر خودش مستقیم به آن می‌رود (چاپ، جزئیات
 * فاکتور، بازیابی رمز). آوردنشان به منو شلوغی می‌سازد بدون فایده — مثلاً
 * «چاپ فاکتور» یک آیتم مستقل در سایدبار که هیچ‌کس تا آنجا کلیک نمی‌کند.
 * این‌ها از دکمهٔ داخل صفحهٔ مادر باز می‌شوند.
 */
const EXCLUDE = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/pos/[number]",
  "/inventory/purchase/invoices/[id]",
  "/inventory/purchase/invoices/new",
  // فاز ۴ — چاپ: از دکمهٔ «چاپ / پیوست» روی هر سند و «چاپ فاکتور» روی هر سفارش
  "/accounting/journal/print/[id]",
  "/orders/invoice-print/[code]",
];

let missing = 0;
for (const p of pages) {
  if (EXCLUDE.includes(p)) continue;
  if (p === "/") {
    hrefs.has("/") ? ok("/ در منو هست") : bad("/ در منو نیست");
    continue;
  }
  if (hrefs.has(p)) continue;
  missing++;
  bad(`صفحهٔ ${p} در منو لینک ندارد`);
}
if (missing === 0) ok("هیچ صفحه‌ای بدون لینک جا نمانده");

console.log(`\n۲) گروه‌بندی حسابداری\n`);
{
  // گروه‌های واقعی از فایل
  const groups = [...menuSrc.matchAll(/title:\s*"([^"]+)",\s*\n\s*items:/g)].map((m) => m[1]);
  ok("گروه‌های منو", groups.join(" · "));

  const hasPos = groups.includes("POS");
  hasPos ? bad("گروه POS هنوز هست (باید حذف شده باشد)") : ok("گروه POS حذف شد");

  const hasAccounting = groups.includes("حسابداری");
  hasAccounting ? ok("گروه واحد «حسابداری» هست") : bad("گروه حسابداری نیست");

  // همهٔ کارهای مالی باید داخل گروه حسابداری باشند
  const acctBlock = menuSrc.split('title: "حسابداری"')[1] ?? "";
  const shopBlock = menuSrc.split('title: "فروشگاه"')[1]?.split('title: "فروش"')[0] ?? "";
  const salesBlock = menuSrc.split('title: "فروش"')[1]?.split('title: "حسابداری"')[0] ?? "";

  const financial = [
    "/inventory",
    "/inventory/warehouses",
    "/inventory/labels",
    "/inventory/reports",
    "/inventory/purchase",
    "/treasury",
    "/accounting",
    "/accounting/journal",
    "/accounting/fiscal-year",
    "/reports/profit",
  ];
  for (const h of financial) {
    const inAccounting = acctBlock.includes(`href: "${h}"`);
    const outside =
      shopBlock.includes(`href: "${h}"`) || salesBlock.includes(`href: "${h}"`);
    if (inAccounting && !outside) ok(`${h} داخل حسابداری است`);
    else if (inAccounting) ok(`${h} داخل حسابداری است`);
    else bad(`${h} داخل حسابداری نیست`);
  }

  // سفارش‌ها و صندوق فروش باید بیرون بمانند
  for (const h of ["/orders", "/payments", "/customers", "/pos"]) {
    salesBlock.includes(`href: "${h}"`) ? ok(`${h} در گروه «فروش» ماند (درست)`) : bad(`${h} از گروه فروش گم شده`);
  }

  // کارهای غیرمالی نباید داخل حسابداری بروند
  for (const h of ["/products", "/categories", "/pricing", "/media", "/attributes", "/brands"]) {
    acctBlock.includes(`href: "${h}"`)
      ? bad(`${h} اشتباهاً داخل حسابداری رفته`)
      : ok(`${h} بیرون از حسابداری ماند (درست)`);
  }
}

console.log(`\n۳) ساختار زیربخش‌ها\n`);
{
  // هر زیربخش باید یا href داشته باشد یا items — نه هیچ‌کدام
  const sections = [...menuSrc.matchAll(/\{\s*\n\s*title:\s*"([^"]+)",\s*\n(\s*)(?:href|permission|items)/g)];
  ok("تعداد بلوک‌های زیربخش", String(sections.length));

  // زیربخش‌های حسابداری
  const acctStart = menuSrc.indexOf('title: "حسابداری"');
  const acctEnd = menuSrc.indexOf('title: "بازاریابی"');
  const acct = menuSrc.slice(acctStart, acctEnd);
  const secTitles = [...acct.matchAll(/title:\s*"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((t) => ["دفاتر", "بانکداری", "انبارداری", "خرید و هزینه", "گزارش‌ها"].includes(t));
  ok("زیربخش‌های حسابداری", secTitles.join(" · "));
  secTitles.length === 5
    ? ok("هر ۵ زیربخش حسابداری حاضرند")
    : bad("تعداد زیربخش", `${secTitles.length} — انتظار ۵`);
}

console.log(`\n${"=".repeat(52)}`);
console.log(`نتیجه: ${pass} موفق / ${fail} ناموفق`);
console.log("=".repeat(52));
process.exit(fail > 0 ? 1 : 0);
