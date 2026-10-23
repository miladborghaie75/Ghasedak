#!/usr/bin/env node
/**
 * بررسی زندهٔ شش صفحهٔ محتوایی (درباره ما، تماس، قوانین، حریم، ارسال، بازگشت).
 *
 * ادعایی که این اسکریپت اثبات می‌کند — همان شکایتی که این گام را ساخت:
 *   «صفحه‌ای که صفحه‌ساز می‌سازد باید دقیقاً همان چیزی باشد که سایت نشان
 *    می‌دهد: بدون هیرو، با همان تیترها و همان متن.»
 *
 * برای هر مسیر:
 *   ۱) صفحه را می‌گیرد (حالت چیدمان پیش‌فرض) — ادعا: دقیقاً یک `h1`، نوارِ
 *      پیمایشِ صفحه‌های محتوایی حاضر، و تیترِ `<title>` نام برند را دارد؛
 *   ۲) صفحه را در صفحه‌ساز **منتشر** می‌کند و دوباره می‌گیرد — ادعا: همچنان
 *      یک `h1` (یعنی هیرو وارد نشده) و **متنِ قابل‌مشاهده عیناً همان است**؛
 *   ۳) انتشار را لغو می‌کند — ادعا: صفحه به همان چیدمان اول برمی‌گردد.
 *
 * بدون وابستگی (fetch خود Node)؛ فقط API و فروشگاه باید بالا باشند.
 * اجرا: `node scripts/verify-content-pages.mjs [sfOrigin] [apiOrigin]`
 */
const SF = process.argv[2] ?? process.env.SF_ORIGIN ?? "http://127.0.0.1:3111";
const API = process.argv[3] ?? process.env.API_ORIGIN ?? "http://127.0.0.1:4000";
const EMAIL = process.env.GHASEDAK_ADMIN_EMAIL ?? "admin@ghasedak.demo";
const PASSWORD = process.env.GHASEDAK_ADMIN_PASSWORD ?? "Ghasedak#Demo1";

const SLUGS = ["about", "contact", "returns", "shipping", "privacy", "terms"];

const failures = [];
const notes = [];
const fail = (m) => failures.push(m);
const ok = (m) => notes.push(`  ✔ ${m}`);

/**
 * متنِ قابل‌مشاهدهٔ صفحه — برای مقایسهٔ دو رندر.
 *
 * `<title>` هم حذف می‌شود چون محتوای head است نه صفحه (و مقایسهٔ آن با
 * نسخهٔ CMS فقط نویز می‌سازد). نیم‌فاصله هم یکی می‌شود: دو عنوانِ
 * «درباره ما» و «دربارهٔ ما» یک متن‌اند، نه دو محتوا.
 */
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<title[\s\S]*?<\/title>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\u200c/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const countH1 = (html) => (html.match(/<h1[\s>]/gi) ?? []).length;
const pageTitle = (html) => (html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "").trim();

async function get(url) {
  const r = await fetch(url, { redirect: "manual" });
  return { status: r.status, html: r.status >= 400 ? "" : await r.text() };
}

/**
 * ورود ادمین — نشست به‌صورت کوکی httpOnly می‌آید (نه در بدنهٔ پاسخ)،
 * پس همان جفتِ کوکی را برای بقیهٔ درخواست‌ها نگه می‌داریم.
 */
async function login() {
  const r = await fetch(`${API}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`ورود ناموفق (HTTP ${r.status}) — creds را با GHASEDAK_ADMIN_* بده`);
  const cookies = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [];
  const hit = cookies.find((c) => c.startsWith("ghasedak_admin_session="));
  if (!hit) throw new Error("کوکی نشست در پاسخ ورود نیست");
  return hit.split(";")[0];
}

const asAdmin = (session) => ({ cookie: session });

async function adminPost(token, path) {
  const r = await fetch(`${API}/api/v1${path}`, { method: "POST", headers: asAdmin(token) });
  return r.ok;
}

const main = async () => {
  const session = await login();
  console.log(`بررسی زندهٔ صفحه‌های محتوایی — فروشگاه: ${SF}`);

  for (const slug of SLUGS) {
    const path = `/${slug}`;
    // ── ۱) چیدمان پیش‌فرض (صفحه منتشر نیست — از قبلِ این تست لغو انتشار می‌کنیم)
    await adminPost(session, `/admin/pages/${slug}/unpublish`);
    const a = await get(`${SF}${path}`);
    if (a.status !== 200) {
      fail(`${path}: وضعیت ${a.status} — صفحه بالا نیامد`);
      continue;
    }
    if (countH1(a.html) !== 1) fail(`${path}: چیدمان پیش‌فرض ${countH1(a.html)} تا h1 دارد (انتظار: ۱)`);
    if (!a.html.includes('aria-label="مسیر صفحه"')) fail(`${path}: نوار پیمایش صفحه‌های محتوایی نیست`);
    if (!pageTitle(a.html).includes("قاصدک")) fail(`${path}: تیتر صفحه نام برند را ندارد: «${pageTitle(a.html)}»`);

    // ── ۲) انتشار و مقایسهٔ متن
    if (!(await adminPost(session, `/admin/pages/${slug}/publish`))) {
      fail(`${path}: انتشار ناموفق — آیا صفحه در صفحه‌ساز ساخته شده؟`);
      continue;
    }
    const b = await get(`${SF}${path}`);
    if (b.status !== 200) {
      fail(`${path}: بعد از انتشار صفحه ${b.status} شد`);
      continue;
    }
    if (countH1(b.html) !== 1) fail(`${path}: نسخهٔ CMS ${countH1(b.html)} تا h1 دارد — یعنی هیرو وارد شده`);
    if (!b.html.includes("data-block-id")) fail(`${path}: نسخهٔ CMS از رندر صفحه‌ساز نمی‌آید`);
    const ta = visibleText(a.html);
    const tb = visibleText(b.html);
    if (ta !== tb) {
      const i = [...ta].findIndex((c, idx) => c !== [...tb][idx]);
      fail(
        `${path}: متنِ نسخهٔ CMS با چیدمان پیش‌فرض یکی نیست (اولین اختلاف نزدیک نویسهٔ ${i})`,
      );
    } else {
      ok(`${path}: متنِ منتشرشده عین چیدمان پیش‌فرض است (${ta.length} نویسه، یک h1)`);
    }
    if (!pageTitle(b.html).includes("قاصدک")) fail(`${path}: بعد از انتشار نام برند از تیتر افتاد`);

    // ── ۳) لغو انتشار → برگشت به حالت اول
    await adminPost(session, `/admin/pages/${slug}/unpublish`);
    const c = await get(`${SF}${path}`);
    if (c.status !== 200 || visibleText(c.html) !== ta) {
      fail(`${path}: بعد از لغو انتشار صفحه به چیدمان اول برنگشت`);
    } else {
      ok(`${path}: لغو انتشار → برگشت کامل به چیدمان پیش‌فرض`);
    }
  }

  console.log(notes.join("\n"));
  if (failures.length === 0) {
    console.log(`\n✔ هر شش مسیر سالم است — ساختار پنل و سایت یکی است.`);
    process.exit(0);
  }
  console.error(`\n✘ ${failures.length} مشکل:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
