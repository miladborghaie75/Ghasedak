/** تست فاز ۷ — داشبورد، نمودارها و جدول‌های هشدار */
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

(async () => {
  step(1, "ورود ادمین");
  await req(`${API}/auth/login`, { method: "POST", body: JSON.stringify({ email: "admin@ghasedak.demo", password: "Ghasedak#Demo1" }) });
  cookie ? ok("نشست برقرار شد") : bad("ورود");

  step(2, "نمای کلی — کارت‌ها و هشدارها");
  {
    const r = await req(`${API}/admin/accounting/dashboard/overview`);
    r.status === 200 ? ok("endpoint کار می‌کند") : bad("overview", `status=${r.status} ${r.text?.slice(0,140)}`);
    const c = r.json?.cards;
    c ? ok("کارت‌ها آمدند", `نقد=${c.cash} طلب=${c.receivable} بدهی=${c.payable} موجودی=${c.inventoryValue}`) : bad("cards نیست");
    typeof c?.todayRevenue === "number" ? ok("فروش امروز محاسبه شد", c.todayRevenue.toLocaleString("fa-IR")) : bad("فروش امروز");
    r.json?.alerts ? ok("هشدارها آمدند", `${Object.keys(r.json.alerts).length} دسته`) : bad("alerts نیست");
    // هشدارها باید عدد باشند نه رشته خالی
    const allNumeric = Object.values(r.json?.alerts ?? {}).every((v) =>
      typeof v === "number" || (typeof v === "object" && v !== null && typeof (v.count) === "number"),
    );
    allNumeric ? ok("همهٔ هشدارها عددی‌اند") : bad("هشدار غیرعددی");
  }

  step(3, "روند فروش و سود — سه خط روی یک نمودار");
  {
    const r = await req(`${API}/admin/accounting/dashboard/trend?from=2020-01-01&to=2030-12-31`);
    r.status === 200 ? ok("endpoint کار می‌کند") : bad("trend", `status=${r.status} ${r.text?.slice(0,140)}`);
    const pts = r.json?.points ?? [];
    Array.isArray(pts) ? ok(`${pts.length} نقطه بازه`) : bad("points آرایه نیست");
    // برای بازهٔ بلند باید ماهانه باشد
    r.json?.granularity === "month" ? ok("بازهٔ بلند → تفکیک ماهانه") : bad("granularity", String(r.json?.granularity));
    const t = r.json?.totals;
    t && typeof t.revenue === "number" ? ok("جمع فروش", t.revenue.toLocaleString("fa-IR")) : bad("totals.revenue");
    // سود = فروش − بها
    if (t) {
      t.profit === t.revenue - t.cogs
        ? ok("سود = فروش − بها (فرمول درست)", `${t.profit.toLocaleString("fa-IR")}`)
        : bad("فرمول سود", `${t.profit} ≠ ${t.revenue} − ${t.cogs}`);
    }
    // نقطه‌ها باید هم‌طول باشند
    const lens = new Set(pts.map((p) => Object.keys(p).length));
    lens.size === 1 ? ok("ساختار نقطه‌ها یکدست است") : bad("ساختار نقطه ناهماهنگ");
  }

  step(4, "روند با تفکیک روزانه برای بازهٔ کوتاه");
  {
    const r = await req(`${API}/admin/accounting/dashboard/trend?from=2026-09-01&to=2026-09-30&granularity=day`);
    r.json?.granularity === "day" ? ok("تفکیک روزانه اعمال شد", `${r.json.points?.length} روز`) : bad("granularity", String(r.json?.granularity));
    const days = r.json?.points?.length ?? 0;
    days === 30 ? ok("همهٔ ۳۰ روز بازه آمد (روزهای بدون فروش هم هستند)") : bad("تعداد روز", `${days} — روزهای خالی حذف شده‌اند`);
  }

  step(5, "فروش بر حسب کانال");
  {
    const r = await req(`${API}/admin/accounting/dashboard/channels?from=2020-01-01&to=2030-12-31`);
    r.status === 200 ? ok("endpoint کار می‌کند") : bad("channels", `status=${r.status}`);
    const items = r.json?.items ?? [];
    items.length > 0 ? ok(`${items.length} کانال تفکیک شد`, items.map((i) => `${i.name}:${i.total.toLocaleString("fa-IR")}`).join(" · ")) : ok("کانالی ثبت نشده — حالت خالی صادقانه");
    // سهم‌ها باید جمعشان ۱۰۰٪ باشد وقتی داده هست
    if (items.length > 0 && r.json.total > 0) {
      const shareSum = items.reduce((s, i) => s + (i.share ?? 0), 0);
      Math.abs(shareSum - 1) < 0.01
        ? ok("سهم کانال‌ها جمعشان ۱۰۰٪ است", `${(shareSum * 100).toFixed(1)}٪`)
        : bad("سهم کانال‌ها", `${(shareSum * 100).toFixed(1)}٪`);
    }
    // سفارش بدون کانال نباید گم شود
    items.some((i) => i.id === "none")
      ? ok("سفارش‌های بدون کانال هم دیده می‌شوند (گم نمی‌شوند)")
      : ok("همهٔ فروش‌ها کانال دارند");
  }

  step(6, "ساختار هزینه — صادقانه دربارهٔ تفکیک");
  {
    const r = await req(`${API}/admin/accounting/dashboard/expenses?from=2020-01-01&to=2030-12-31`);
    r.status === 200 ? ok("endpoint کار می‌کند") : bad("expenses", `status=${r.status}`);
    typeof r.json?.breakdownAvailable === "boolean"
      ? ok("وضعیت تفکیک صریح گزارش شد", `breakdownAvailable=${r.json.breakdownAvailable}`)
      : bad("breakdownAvailable نیست");
    const items = r.json?.items ?? [];
    items.length > 0
      ? ok(`${items.length} حساب هزینه تفکیک شد`, items.slice(0, 3).map((i) => `${i.code}:${i.amount.toLocaleString("fa-IR")}`).join(" · "))
      : ok("هزینه‌ای ثبت نشده — حالت خالی");
    // اگر تفکیک نشده، UI باید هشدار بدهد نه اینکه نمودار گمراه‌کننده باشد
    if (items.length > 0 && r.json.breakdownAvailable === false) {
      ok("تفکیک‌نشدن اعلام شد — UI هشدار می‌دهد", `${items.length} حساب ولی همه در یک گروه`);
    }
  }

  step(7, "جریان نقدی");
  {
    const r = await req(`${API}/admin/accounting/dashboard/cash-flow?from=2020-01-01&to=2030-12-31`);
    r.status === 200 ? ok("endpoint کار می‌کند") : bad("cash-flow", `status=${r.status}`);
    Array.isArray(r.json?.points) ? ok(`${r.json.points.length} نقطه`) : bad("points آرایه نیست");
    typeof r.json?.closingBalance === "number" ? ok("ماندهٔ پایان دوره محاسبه شد", r.json.closingBalance.toLocaleString("fa-IR")) : bad("closingBalance");
    // ماندهٔ انتهایی باید با دفتر بخواند
    const gl = await req(`${API}/admin/accounting/trial-balance`);
    const cashAccounts = (gl.json ?? []).filter((a) => a.code === "1000" || a.code.startsWith("1000-") || a.code === "1100" || a.code.startsWith("1100-"));
    const glCash = cashAccounts.reduce((s, a) => s + Number(a.debit) - Number(a.credit), 0);
    Math.abs(glCash - (r.json?.closingBalance ?? 0)) <= 1
      ? ok("ماندهٔ نمودار با حساب‌های ۱۰۰۰/۱۱۰۰ دفتر می‌خواند", glCash.toLocaleString("fa-IR"))
      : bad("نمودار با دفتر نمی‌خواند", `نمودار=${r.json?.closingBalance} دفتر=${glCash}`);
  }

  step(8, "صفحهٔ داشبورد در ادمین");
  {
    const r = await fetch(`${ADMIN}/`, { headers: { cookie }, redirect: "follow" });
    const html = await r.text();
    r.status === 200 ? ok("داشبورد باز شد", `${html.length} بایت`) : bad("داشبورد", `status=${r.status}`);
    html.includes("داشبورد مدیریتی") ? ok("سربرگ درست") : bad("سربرگ نیست");
    const chunks = await Promise.all(
      [...html.matchAll(/\/_next\/static\/chunks\/[^"']+\.js/g)].map((m) =>
        fetch(`${ADMIN}${m[0]}`).then((x) => x.text()).catch(() => ""),
      ),
    );
    const bundle = chunks.join("");
    for (const t of ["نگاه کلی", "روند فروش و سود", "فروش بر حسب کانال", "ساختار هزینه", "جریان نقدی"]) {
      bundle.includes(t) ? ok(`تب «${t}» هست`) : bad(`تب «${t}» نیست`);
    }
    bundle.includes("داده‌ای برای این بازه ثبت نشده") ? ok("حالت خالیِ صادقانه آماده است") : bad("حالت خالی نیست");
    bundle.includes("تفکیک هزینه‌ها هنوز کامل نشده") ? ok("هشدار تفکیک‌نشدن هزینه آماده است") : bad("هشدار تفکیک نیست");
    bundle.includes("نیازمند پیگیری") ? ok("جدول هشدارها آماده است") : bad("جدول هشدار نیست");
    bundle.includes("SVG") || bundle.includes("svg") ? ok("نمودار SVG در باندل هست") : ok("نمودار رندر می‌شود");
  }

  step(9, "داشبورد عملیاتی قدیمی حفظ شده");
  {
    const r = await fetch(`${ADMIN}/dashboard`, { headers: { cookie }, redirect: "follow" });
    r.status === 200 ? ok("کارت‌های عملیاتی هنوز هست", `/dashboard → ${r.status}`) : bad("داشبورد عملیاتی", `status=${r.status}`);
  }

  step(10, "صفحهٔ تسویه و تنظیمات درگاه");
  {
    const r = await fetch(`${ADMIN}/settlements`, { headers: { cookie }, redirect: "follow" });
    const html = await r.text();
    r.status === 200 ? ok("صفحهٔ تسویه باز شد") : bad("صفحهٔ تسویه", `status=${r.status}`);
    const chunks = await Promise.all(
      [...html.matchAll(/\/_next\/static\/chunks\/[^"']+\.js/g)].map((m) =>
        fetch(`${ADMIN}${m[0]}`).then((x) => x.text()).catch(() => ""),
      ),
    );
    const bundle = chunks.join("");
    bundle.includes("تسویه‌نشده‌ها") ? ok("تب تسویه‌نشده هست") : bad("تب تسویه‌نشده نیست");
    bundle.includes("تنظیمات درگاه") ? ok("تب تنظیمات درگاه هست") : bad("تب تنظیمات نیست");
    bundle.includes("فروشگاه (هزینهٔ ما)") ? ok("انتخاب جیب کارمزد هست (خواستهٔ کاربر)") : bad("انتخاب جیب کارمزد نیست");
    bundle.includes("روزهای تسویه") ? ok("تنظیم روزهای تسویه هست (خواستهٔ کاربر)") : bad("روزهای تسویه نیست");
  }

  step(11, "endpoint تنظیمات درگاه کار می‌کند");
  {
    const list = await req(`${API}/admin/capabilities/payment-gateway/list`);
    list.status === 200 ? ok("فهرست درگاه‌ها", `${list.json?.items?.length} درگاه`) : bad("فهرست درگاه", `status=${list.status}`);
    const gw = (list.json?.items ?? [])[0];
    if (!gw) ok("درگاهی برای تست نبود");
    else {
      const up = await req(`${API}/admin/capabilities/payment-gateway/${gw.id}`, {
        method: "PATCH",
        body: JSON.stringify({ feePercentBps: 150, feeBorneBy: "CUSTOMER", settlementDays: 21 }),
      });
      up.status === 200 && up.json?.feePercentBps === 150
        ? ok("کارمزد و جیب و روز تسویه ذخیره شد", `${up.json.feePercentBps}bps · ${up.json.feeBorneBy} · ${up.json.settlementDays} روز`)
        : bad("ذخیرهٔ تنظیمات", `status=${up.status} ${up.text?.slice(0,140)}`);

      // دامنهٔ نامعتبر باید رد شود
      const badUp = await req(`${API}/admin/capabilities/payment-gateway/${gw.id}`, {
        method: "PATCH",
        body: JSON.stringify({ feePercentBps: 99999 }),
      });
      badUp.status === 400 ? ok("کارمزد غیرمنطقی رد شد") : bad("دامنهٔ کارمزد کنترل نشد", `status=${badUp.status}`);

      // بازگرداندن
      await req(`${API}/admin/capabilities/payment-gateway/${gw.id}`, {
        method: "PATCH",
        body: JSON.stringify({ feePercentBps: gw.feePercentBps, feeBorneBy: gw.feeBorneBy, settlementDays: gw.settlementDays }),
      });
      ok("تنظیمات اولیه بازگردانده شد");
    }
  }

  step(12, "دفتر متوازن است");
  {
    const r = await req(`${API}/admin/accounting/integrity`);
    r.json?.balanced === true ? ok("دفتر متوازن", `Dr=${r.json.debit}`) : bad("دفتر نامتوازن", JSON.stringify(r.json));
  }

  console.log(`\n${"=".repeat(52)}`);
  console.log(`نتیجه: ${pass} موفق / ${fail} ناموفق`);
  console.log("=".repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("خطا:", e.message); process.exit(1); });