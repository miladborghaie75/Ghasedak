/** بررسی نهایی فاز ۰٫۱ — سیستم سال مالی */
const API = "http://localhost:4000/api/v1";
const ADMIN = "http://localhost:3200";
let cookie = "";
let pass = 0, fail = 0;
const ok = (l, x = "") => { console.log(`  PASS  ${l}${x ? " — " + x : ""}`); pass++; };
const bad = (l, x = "") => { console.log(`  FAIL  ${l}${x ? " — " + x : ""}`); fail++; };
const step = (n, t) => console.log(`\n${n}) ${t}`);

async function req(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.body ? { "content-type": "application/json; charset=utf-8" } : {}), ...(cookie ? { cookie } : {}) },
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const kv = c.split(";")[0];
    if (kv.startsWith("ghasedak_admin_session=")) cookie = kv;
  }
  const t = await res.text();
  try { return { status: res.status, json: JSON.parse(t), text: t }; } catch { return { status: res.status, json: null, text: t }; }
}

const STAMP = Date.now();
let newId = null;
let oldOpenId = null;

/** درخواست به ادمین با کوکی نشست — بدون آن به صفحهٔ لاگین می‌رود */
async function adminGet(path) {
  const res = await fetch(`${ADMIN}${path}`, { headers: { cookie }, redirect: "follow" });
  return { status: res.status, html: await res.text() };
}

(async () => {
  step(1, "ورود");
  {
    const r = await req(`${API}/auth/login`, { method: "POST", body: JSON.stringify({ email: "admin@ghasedak.demo", password: "Ghasedak#Demo1" }) });
    r.status === 200 && cookie ? ok("نشست برقرار شد") : bad("ورود", `status=${r.status}`);
  }

  step(2, "بررسی سلامت سیستم مالی");
  {
    const r = await req(`${API}/admin/accounting/fiscal-year/health`);
    r.status === 200 ? ok("endpoint سلامت کار می‌کند") : bad("health", `status=${r.status}`);
    r.json?.healthy === true ? ok("سیستم سالم است", `${r.json.openCount} سال باز، ${r.json.accountCount} حساب`) : bad("سیستم ناسالم", JSON.stringify(r.json?.problems));
  }

  step(3, "فهرست سال‌ها — یک سال باز");
  {
    const r = await req(`${API}/admin/accounting/fiscal-year`);
    const open = (r.json?.items ?? []).filter((y) => y.state === "OPEN");
    open.length === 1 ? ok("دقیقاً یک سال باز", open[0].title) : bad("سال باز", `${open.length}`);
    r.json?.openId === open[0]?.id ? ok("openId درست است") : bad("openId");
  }

  step(4, "سند جدید روی سال باز ثبت می‌شود");
  {
    const r = await req(`${API}/admin/accounting/journal/manual`, {
      method: "POST",
      body: JSON.stringify({
        description: "تست فاز ۰ — سال باز",
        state: "FINAL",
        lines: [{ accountCode: "1000", debit: 1000 }, { accountCode: "3000", credit: 1000 }],
      }),
    });
    r.json?.state === "FINAL" ? ok("سند ثبت شد", r.json.number) : bad("ثبت سند", `status=${r.status} ${r.text.slice(0,140)}`);
  }

  step(5, "دفترها متوازن‌اند");
  {
    const r = await req(`${API}/admin/accounting/integrity`);
    r.json?.balanced === true ? ok("توازن برقرار", `Dr=${r.json.debit} Cr=${r.json.credit}`) : bad("نامتوازن", JSON.stringify(r.json));
  }

  step(6, "صفحهٔ سال مالی در ادمین باز می‌شود");
  {
    const r = await adminGet("/accounting/fiscal-year");
    r.status === 200 ? ok("صفحه باز شد", `${r.html.length} بایت`) : bad("صفحه", `status=${r.status}`);
    r.html.includes("سال مالی") ? ok("عنوان درست") : bad("محتوا");
    // «سال مالی جدید» زیرمتنِ دکمهٔ «+ سال مالی جدید» است
    r.html.includes("سال مالی جدید") ? ok("دکمهٔ ساخت سال هست") : bad("دکمهٔ ساخت سال نیست");
    // «بستن سال» فقط بعد از رسیدن داده رندر می‌شود (useEffect)، پس در HTML
    // سرور-رندرشده نیست. وجودش را در باندل جاوااسکریپت بررسی می‌کنیم؛
    // خودِ عملیات بستن در verify-fiscal-year.mjs با ۲۰ تست پوشش داده شده.
    const chunks = await Promise.all(
      [...r.html.matchAll(/\/_next\/static\/chunks\/[^"']+\.js/g)].map((m) =>
        fetch(`${ADMIN}${m[0]}`).then((x) => x.text()).catch(() => ""),
      ),
    );
    const bundle = chunks.join("");
    bundle.includes("بستن سال") ? ok("دکمهٔ بستن سال در باندل هست") : bad("دکمهٔ بستن سال در باندل نیست");
  }

  step(7, "منو شامل سال مالی و اسناد است");
  {
    const r = await adminGet("/");
    r.html.includes("/accounting/fiscal-year") ? ok("لینک سال مالی در منو") : bad("لینک سال مالی");
    r.html.includes("/accounting/journal") ? ok("لینک اسناد در منو") : bad("لینک اسناد");
  }

  step(8, "پاک‌سازی سند تست");
  {
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient();
    const rows = await db.journalEntry.findMany({ where: { description: "تست فاز ۰ — سال باز" }, select: { id: true } });
    await db.journalLine.deleteMany({ where: { entryId: { in: rows.map((r) => r.id) } } });
    await db.journalEntry.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    await db.$disconnect();
    ok(`${rows.length} سند تست پاک شد`);
  }

  console.log(`\n${"=".repeat(52)}`);
  console.log(`نتیجه: ${pass} موفق / ${fail} ناموفق`);
  console.log("=".repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("خطا:", e.message); process.exit(1); });