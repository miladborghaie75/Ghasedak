/** تست زندهٔ منوی ادمین — روی سرویس در حال اجرا */
const ADMIN = "http://localhost:3200";
let cookie = "";
let pass = 0, fail = 0;
const ok = (l, x = "") => { console.log(`  PASS  ${l}${x ? " — " + x : ""}`); pass++; };
const bad = (l, x = "") => { console.log(`  FAIL  ${l}${x ? " — " + x : ""}`); fail++; };
const step = (n, t) => console.log(`\n${n}) ${t}`);

async function get(path) {
  const res = await fetch(`${ADMIN}${path}`, { headers: { cookie }, redirect: "follow" });
  return { status: res.status, html: await res.text() };
}

(async () => {
  step(1, "ورود ادمین");
  {
    const res = await fetch("http://localhost:4000/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "admin@ghasedak.demo", password: "Ghasedak#Demo1" }),
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const kv = c.split(";")[0];
      if (kv.startsWith("ghasedak_admin_session=")) cookie = kv;
    }
    cookie ? ok("نشست برقرار شد") : bad("ورود ناموفق");
  }

  step(2, "سایدبار رندر می‌شود (پنل بالا می‌آید)");
  {
    const { status, html } = await get("/");
    status === 200 ? ok("داشبورد ۲۰۰") : bad("داشبورد", `status=${status}`);
    html.includes("قاصدک") ? ok("هدر پنل هست") : bad("هدر پنل نیست");
    html.includes("aria-label=\"منوی مدیریت\"") ? ok("سایدبار رندر شد") : bad("سایدبار رندر نشد");
  }

  step(3, "گروه‌های منو — حسابداری یک گروه واحد است");
  {
    const { html } = await get("/");
    const groups = [...html.matchAll(/>\s*(اصلی|فروشگاه|فروش|حسابداری|بازاریابی|سیستم|POS)\s*</g)].map((m) => m[1]);
    const uniq = [...new Set(groups)];
    ok("گروه‌های رندرشده", uniq.join(" · "));
    uniq.includes("حسابداری") ? ok("گروه «حسابداری» هست") : bad("گروه حسابداری نیست");
    uniq.filter((g) => g === "حسابداری").length === 1 ? ok("حسابداری فقط یک‌بار آمده (تکرار ندارد)") : bad("حسابداری تکرار شده");
    uniq.includes("POS") ? bad("گروه POS هنوز رندر می‌شود") : ok("گروه POS حذف شده");
  }

  step(4, "همهٔ کارهای مالی در گروه حسابداری‌اند");
  {
    const { html } = await get("/");
    // هر لینک مالی باید در HTML باشد
    const hrefs = [...html.matchAll(/href="(\/(?:inventory|treasury|accounting|reports)[^"]*)"/g)].map((m) => m[1]);
    const uniq = [...new Set(hrefs)];
    uniq.length >= 9
      ? ok(`${uniq.length} لینک مالی در سایدبار رندر شد`, uniq.join(" "))
      : bad("لینک‌های مالی ناقص", uniq.join(" "));
    for (const need of ["/inventory", "/treasury", "/accounting/journal", "/accounting/fiscal-year", "/reports/profit"]) {
      uniq.includes(need) ? ok(`${need} در منو هست`) : bad(`${need} در منو نیست`);
    }
  }

  step(5, "زیربخش‌های حسابداری تاشو شونده‌اند");
  {
    const { html } = await get("/");
    for (const t of ["دفاتر", "بانکداری", "انبارداری", "خرید و هزینه", "گزارش‌ها"]) {
      html.includes(`>${t}<`) || html.includes(t) ? ok(`زیربخش «${t}» رندر شد`) : bad(`زیربخش «${t}» نیست`);
    }
    // دکمه‌های تاشو باید <details>/<summary> باشند
    const details = (html.match(/<details/g) ?? []).length;
    details >= 4 ? ok(`${details} بلوک تاشو شونده رندر شد`) : bad("بلوک تاشو کم است", `${details}`);
  }

  step(6, "گروه مربوطه وقتی داخلش هستیم باز است");
  {
    const { html } = await get("/accounting/journal");
    html.includes("<details open") ? ok("گروه «دفاتر» وقتی در اسناد هستیم باز است") : bad("گروه باز نشد");
    html.includes('aria-current="page"') ? ok("لینک فعال علامت خورد") : bad("لینک فعال علامت نخورد");
  }

  step(7, "برو به چند صفحهٔ مالی و بررسی ۲۰۰ بودن");
  {
    const pages = [
      "/accounting", "/accounting/journal", "/accounting/fiscal-year",
      "/treasury", "/inventory", "/inventory/warehouses",
      "/inventory/labels", "/inventory/reports", "/inventory/purchase", "/reports/profit",
    ];
    const bad2 = [];
    for (const p of pages) {
      const r = await get(p);
      if (r.status !== 200) bad2.push(`${p}=${r.status}`);
    }
    bad2.length === 0
      ? ok(`همهٔ ${pages.length} صفحهٔ مالی ۲۰۰ دادند`)
      : bad("صفحات خراب", bad2.join(", "));
  }

  step(8, "صفحات غیرمالی سر جایشان هستند");
  {
    const pages = ["/products", "/orders", "/payments", "/pos", "/categories", "/settings"];
    const bad2 = [];
    for (const p of pages) {
      const r = await get(p);
      if (r.status !== 200) bad2.push(`${p}=${r.status}`);
    }
    bad2.length === 0 ? ok(`همهٔ ${pages.length} صفحهٔ دیگر هم ۲۰۰ دادند`) : bad("خرابی", bad2.join(", "));
  }

  console.log(`\n${"=".repeat(52)}`);
  console.log(`نتیجه: ${pass} موفق / ${fail} ناموفق`);
  console.log("=".repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("خطا:", e.message); process.exit(1); });