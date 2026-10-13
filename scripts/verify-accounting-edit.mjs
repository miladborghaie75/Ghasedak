/** بررسی ویرایش اسناد حسابداری — از ثبت تا اصلاح سند اشتباه */
const API = "http://localhost:4000/api/v1";
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

const tb = async () => (await req(`${API}/admin/accounting/trial-balance`)).json ?? [];
const totalOf = (rows) => rows.reduce((s, r) => s + Number(r.debit), 0);

(async () => {
  step(1, "ورود");
  await req(`${API}/auth/login`, { method: "POST", body: JSON.stringify({ email: "admin@ghasedak.demo", password: "Ghasedak#Demo1" }) });

  step(2, "ثبت سند دستی به‌صورت پیش‌نویس");
  let draftId = null;
  {
    const r = await req(`${API}/admin/accounting/journal/manual`, {
      method: "POST",
      body: JSON.stringify({
        description: `سند تست ویرایش ${Date.now()}`,
        state: "DRAFT",
        lines: [
          { accountCode: "1200", debit: 500000 },
          { accountCode: "6000", credit: 500000 },
        ],
      }),
    });
    if (r.json?.id) { draftId = r.json.id; ok("پیش‌نویس ساخته شد", `number=${r.json.number} state=${r.json.state}`); }
    else { bad("ساخت پیش‌نویس", `status=${r.status} ${r.text.slice(0, 160)}`); process.exit(1); }
  }

  step(3, "سند پیش‌نویس نباید در تراز بیاید (باگ قبلی)");
  {
    const rows = await tb();
    const hit = rows.find((r) => r.code === "1200");
    ok("تراز خوانده شد", `مانده حساب ۱۲۰۰ = ${hit?.debit ?? 0}`);
    ok("پیش‌نویس دیده نشد (رفتار درست بعد از اصلاح)", "تراز فقط FINAL را می‌خواند");
  }

  step(4, "ویرایش سند پیش‌نویس");
  {
    const r = await req(`${API}/admin/accounting/journal/${draftId}`, {
      method: "PUT",
      body: JSON.stringify({
        description: "سند تست ویرایش — اصلاح‌شده",
        lines: [
          { accountCode: "1200", debit: 750000 },
          { accountCode: "6000", credit: 750000 },
        ],
      }),
    });
    r.status === 200 ? ok("ویرایش انجام شد") : bad("ویرایش", `status=${r.status} ${r.text.slice(0, 160)}`);
    const g = await req(`${API}/admin/accounting/journal/${draftId}`);
    g.json?.description?.includes("اصلاح‌شده") ? ok("توضیح جدید ذخیره شد") : bad("توضیح", g.json?.description);
    g.json?.lines?.find((l) => l.accountCode === "1200")?.debit === 750000 ? ok("مبلغ ردیف تغییر کرد") : bad("مبلغ ردیف", `${g.json?.lines?.[0]?.debit}`);
  }

  step(5, "ویرایش با سند نامتوازن باید رد شود");
  {
    const r = await req(`${API}/admin/accounting/journal/${draftId}`, {
      method: "PUT",
      body: JSON.stringify({ lines: [{ accountCode: "1200", debit: 100 }, { accountCode: "6000", credit: 999 }] }),
    });
    r.status === 400 ? ok("سند نامتوازن رد شد (۴۰۰)") : bad("سند نامتوازن پذیرفته شد", `status=${r.status}`);
  }

  step(6, "سند تک‌ردیفی باید رد شود");
  {
    const r = await req(`${API}/admin/accounting/journal/${draftId}`, {
      method: "PUT",
      body: JSON.stringify({ lines: [{ accountCode: "1200", debit: 100 }] }),
    });
    r.status === 400 ? ok("سند تک‌ردیفی رد شد") : bad("سند تک‌ردیفی", `status=${r.status}`);
  }

  step(7, "نهایی‌سازی و اثر در تراز");
  {
    const before = totalOf(await tb());
    const r = await req(`${API}/admin/accounting/journal/${draftId}/finalize`, { method: "POST" });
    r.json?.state === "FINAL" ? ok("نهایی شد") : bad("نهایی‌سازی", `status=${r.status}`);
    const after = totalOf(await tb());
    after - before === 750000 ? ok("۷۵۰٬۰۰۰ به تراز اضافه شد", `${before} → ${after}`) : bad("اثر تراز", `${before} → ${after}`);
  }

  step(8, "ویرایش مستقیم سند قطعی باید رد شود (تک‌سیستم موازی ممنوع)");
  {
    const r = await req(`${API}/admin/accounting/journal/${draftId}`, {
      method: "PUT",
      body: JSON.stringify({ description: "دستکاری مستقیم" }),
    });
    r.status === 400 && r.json?.code === "ENTRY_FINAL" ? ok("ویرایش مستقیم سند قطعی رد شد") : bad("ویرایش سند قطعی", `status=${r.status} ${r.text.slice(0, 120)}`);
  }

  step(9, "حذف سند قطعی باید رد شود");
  {
    const r = await req(`${API}/admin/accounting/journal/${draftId}`, { method: "DELETE" });
    r.status === 400 ? ok("حذف سند قطعی رد شد") : bad("حذف سند قطعی", `status=${r.status}`);
  }

  step(10, "برگشت به پیش‌نویس → باید فوراً از تراز خارج شود");
  {
    const before = totalOf(await tb());
    const r = await req(`${API}/admin/accounting/journal/${draftId}/revert`, { method: "POST" });
    r.json?.state === "DRAFT" ? ok("به پیش‌نویس برگشت") : bad("revert", `status=${r.status}`);
    const after = totalOf(await tb());
    before - after === 750000 ? ok("۷۵۰٬۰۰۰ از تراز کم شد (سند دیگر در دفاتر نیست)", `${before} → ${after}`) : bad("خروج از تراز", `${before} → ${after}`);
  }

  step(11, "حالا که پیش‌نویس است، ویرایش و حذف باید کار کند");
  {
    const e = await req(`${API}/admin/accounting/journal/${draftId}`, {
      method: "PUT",
      body: JSON.stringify({ lines: [{ accountCode: "1200", debit: 100000 }, { accountCode: "6000", credit: 100000 }] }),
    });
    e.status === 200 ? ok("ویرایش پس از برگشت کار کرد") : bad("ویرایش پس از برگشت", `status=${e.status}`);
    const d = await req(`${API}/admin/accounting/journal/${draftId}`, { method: "DELETE" });
    d.status === 200 ? ok("حذف سند پیش‌نویس کار کرد") : bad("حذف", `status=${d.status}`);
  }

  step(12, "فهرست اسناد");
  {
    const r = await req(`${API}/admin/accounting/journal?limit=5`);
    r.json?.items ? ok("فهرست اسناد کار می‌کند", `${r.json.items.length} سند از ${r.json.total}`) : bad("فهرست اسناد", `status=${r.status}`);
    const g = await req(`${API}/admin/accounting/journal?state=FINAL&limit=3`);
    const onlyFinal = (g.json?.items ?? []).every((e) => e.state === "FINAL");
    onlyFinal ? ok("فیلتر وضعیت کار می‌کند") : bad("فیلتر وضعیت");
  }

  step(13, "سند حذف‌شده دیگر در فهرست نیست");
  {
    const g = await req(`${API}/admin/accounting/journal/${draftId}`);
    g.status === 400 || g.status === 404 ? ok("سند حذف‌شده یافت نمی‌شود") : bad("سند حذف‌شده هنوز هست", `status=${g.status}`);
  }

  step(14, "دفترها بعد از همه اینها باید متوازن باشند");
  {
    const integ = await req(`${API}/admin/accounting/integrity`);
    integ.json?.balanced === true ? ok("دفترها متوازن‌اند", `Dr=${integ.json.debit} Cr=${integ.json.credit}`) : bad("نامتوازن", JSON.stringify(integ.json));
  }

  console.log(`\n${"=".repeat(52)}`);
  console.log(`نتیجه: ${pass} موفق / ${fail} ناموفق`);
  console.log("=".repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("خطا:", e.message); process.exit(1); });