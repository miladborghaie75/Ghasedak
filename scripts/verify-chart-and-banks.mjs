/** تست: کدینگ مستقل + ساخت حساب بانکی/صندوق با حساب GL جدا */
const API = "http://localhost:4000/api/v1";
const ADMIN = "http://localhost:3200";
let cookie = "";
let pass = 0, fail = 0;
const ok = (l, x = "") => { console.log(`  PASS  ${l}${x ? " — " + x : ""}`); pass++; };
const bad = (l, x = "") => { console.log(`  FAIL  ${l}${x ? " — " + x : ""}`); fail++; };
const step = (n, t) => console.log(`\n${n}) ${t}`);
const STAMP = Date.now();

/** عدد با جداکنندهٔ هزارگان فارسی — فقط برای خوانایی خروجی */
const fa = (v) => Number(v || 0).toLocaleString("fa-IR");

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
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();

  step(1, "ورود ادمین");
  await req(`${API}/auth/login`, { method: "POST", body: JSON.stringify({ email: "admin@ghasedak.demo", password: "Ghasedak#Demo1" }) });
  cookie ? ok("نشست برقرار شد") : bad("ورود");

  step(2, "زیرحساب‌های بانک و صندوق ساخته شده‌اند");
  {
    const banks = await db.account.count({ where: { code: { startsWith: "1100-" } } });
    const cash = await db.account.count({ where: { code: { startsWith: "1000-" } } });
    banks > 0 ? ok(`${banks} زیرحساب بانک آماده است`) : bad("زیرحساب بانک نیست");
    cash > 0 ? ok(`${cash} زیرحساب صندوق آماده است`) : bad("زیرحساب صندوق نیست");
  }

  step(3, "endpoint فهرست حساب‌های GL کار می‌کند");
  let glList = [];
  {
    const r = await req(`${API}/admin/treasury/gl-accounts?kind=bank`);
    glList = Array.isArray(r.json) ? r.json : [];
    glList.length > 0 ? ok("فهرست حساب‌ها آمد", glList.slice(0, 3).map((g) => g.code).join(" · ")) : bad("فهرست خالی", `status=${r.status}`);
    const hasGroup = glList.some((g) => g.code === "1100");
    const hasSub = glList.some((g) => String(g.code).startsWith("1100-"));
    hasGroup && hasSub ? ok("گروه و زیرحساب هر دو در فهرست‌اند") : bad("ساختار فهرست", `group=${hasGroup} sub=${hasSub}`);
    const onlyAssets = glList.every((g) => String(g.code).startsWith("11") || String(g.code).startsWith("10"));
    onlyAssets ? ok("فقط حساب‌های گروه بانک/صندوق") : bad("حساب نامربوط در فهرست");
  }

  step(4, "ساخت حساب بانکی — خودکار روی زیرحساب آزاد");
  let bankName1 = null;
  {
    bankName1 = `بانک تست الف ${STAMP}`;
    const r = await req(`${API}/admin/treasury/bank-accounts`, {
      method: "POST",
      body: JSON.stringify({ name: bankName1, bankName: "بانک تست", accountNumber: "100200300", iban: "IR000000000000000000000001" }),
    });
    r.status === 201 || r.status === 200
      ? ok("حساب بانکی ساخته شد", `GL=${r.json?.glCode}`)
      : bad("ساخت حساب بانکی", `status=${r.status} ${r.text?.slice(0, 160)}`);
    r.json?.glCode && String(r.json.glCode).startsWith("1100-")
      ? ok("روی زیرحساب مستقل نشست (نه روی گروه ۱۱۰۰)", r.json.glCode)
      : bad("حساب GL درست نیست", String(r.json?.glCode));
  }

  step(5, "بانک دوم باید زیرحساب جدا بگیرد");
  let bankName2 = null;
  {
    bankName2 = `بانک تست ب ${STAMP}`;
    const r = await req(`${API}/admin/treasury/bank-accounts`, {
      method: "POST",
      body: JSON.stringify({ name: bankName2, bankName: "بانک دوم", accountNumber: "200400500" }),
    });
    const code = r.json?.glCode;
    code && String(code).startsWith("1100-")
      ? ok("بانک دوم زیرحساب جدا گرفت", code)
      : bad("زیرحساب جدا نشد", String(code));
    const accounts = await req(`${API}/admin/treasury/accounts`);
    const rows = accounts.json?.bank ?? [];
    // فقط بانک‌های **همین اجرا** — اجرای قبلی ممکن است داده‌ای جا گذاشته باشد
    const mine = rows.filter((b) => b.name === bankName1 || b.name === bankName2);
    const codes = mine.map((b) => b.glCode);
    mine.length === 2 && new Set(codes).size === 2
      ? ok("دو بانک، دو حساب دفتری مستقل", codes.join(" · "))
      : bad("تفکیک بانک‌ها", `${mine.length} بانک: ${codes.join(" · ")}`);
  }

  step(6, "ساخت صندوق");
  {
    const r = await req(`${API}/admin/treasury/cash-accounts`, {
      method: "POST",
      body: JSON.stringify({ name: `صندوق تست الف ${STAMP}`, kind: "petty" }),
    });
    r.status === 201 || r.status === 200
      ? ok("صندوق ساخته شد", `GL=${r.json?.glCode}`)
      : bad("ساخت صندوق", `status=${r.status} ${r.text?.slice(0, 140)}`);
    r.json?.glCode && String(r.json.glCode).startsWith("1000-")
      ? ok("صندوق هم زیرحساب مستقل گرفت", r.json.glCode)
      : bad("GL صندوق", String(r.json?.glCode));
  }

  step(7, "دو بانک با ماندهٔ مستقل");
  {
    const accounts = await req(`${API}/admin/treasury/accounts`);
    const mine = (accounts.json?.bank ?? []).filter((b) => b.name === bankName1 || b.name === bankName2);
    mine.length === 2 ? ok("هر دو بانک این اجرا در فهرست هستند") : bad("تعداد بانک", `${mine.length}`);
    for (const b of mine) {
      ok(`  ${b.name} → GL ${b.glCode}، ماندهٔ دفتری ${fa(b.glBookBalance ?? "0")}`);
    }
  }

  step(8, "دفتر متوازن است");
  {
    const r = await req(`${API}/admin/accounting/integrity`);
    r.json?.balanced === true ? ok("دفتر متوازن", `Dr=${r.json.debit}`) : bad("نامتوازن", JSON.stringify(r.json));
  }

  step(9, "صفحهٔ کدینگ و منو");
  {
    const c = await fetch(`${ADMIN}/accounting/chart`, { headers: { cookie }, redirect: "follow" });
    const html = await c.text();
    c.status === 200 ? ok("صفحهٔ کدینگ باز می‌شود") : bad("صفحهٔ کدینگ", `status=${c.status}`);
    html.includes("کدینگ") ? ok("عنوان درست") : bad("محتوای صفحه");

    const home = await fetch(`${ADMIN}/accounting`, { headers: { cookie }, redirect: "follow" });
    const h2 = await home.text();
    h2.includes("/accounting/chart") ? ok("لینک کدینگ در صفحهٔ حسابداری هست") : bad("لینک کدینگ نیست");
    h2.includes("ماژول خرید هنوز فعال نشده") ? bad("متن ثابت «ماژول خرید» هنوز هست") : ok("متن ثابت خرید حذف شد");
    (h2.match(/ریز فاکتور خرید|فاکتور خرید/) ? ok("تب فاکتور خرید هست") : bad("تب خرید نیست"));
  }

  step(10, "پاک‌سازی");
  {
    await db.bankAccount.deleteMany({ where: { name: { startsWith: "بانک تست" } } });
    await db.cashAccount.deleteMany({ where: { name: { startsWith: "صندوق تست" } } });
    ok("حساب‌های تست پاک شدند");
  }

  await db.$disconnect();
  console.log(`\n${"=".repeat(52)}`);
  console.log(`نتیجه: ${pass} موفق / ${fail} ناموفق`);
  console.log("=".repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch(async (e) => { console.error("خطا:", e.message); process.exit(1); });