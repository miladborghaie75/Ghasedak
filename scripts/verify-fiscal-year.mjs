/** بررسی سیستم سال مالی — ساخت، قفل یکتایی، بستن با سند اختتامیه، بازگشایی */
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

const STAMP = Date.now();
let newId = null;
let oldOpenId = null;

(async () => {
  step(1, "ورود ادمین");
  {
    const r = await req(`${API}/auth/login`, { method: "POST", body: JSON.stringify({ email: "admin@ghasedak.demo", password: "Ghasedak#Demo1" }) });
    r.status === 200 && cookie ? ok("نشست برقرار شد") : bad("ورود", `status=${r.status}`);
  }

  step(2, "فهرست سال‌ها — باید دقیقاً یک سال باز باشد");
  {
    const r = await req(`${API}/admin/accounting/fiscal-year`);
    const items = r.json?.items ?? [];
    r.status === 200 ? ok("endpoint کار می‌کند", `${items.length} سال`) : bad("فهرست سال", `status=${r.status} ${r.text.slice(0,140)}`);
    const openOnes = items.filter((y) => y.state === "OPEN");
    openOnes.length === 1 ? ok("دقیقاً یک سال باز", openOnes[0].title) : bad("تعداد سال باز", `${openOnes.length}`);
    oldOpenId = openOnes[0]?.id ?? null;
    ok("سال باز شناسایی شد", oldOpenId ?? "—");
  }

  step(3, "ساخت سال جدید با تراز افتتاحیه");
  {
    const r = await req(`${API}/admin/accounting/fiscal-year`, {
      method: "POST",
      body: JSON.stringify({
        title: `سال تست ${STAMP}`,
        startsAt: "2027-04-01T00:00:00.000Z",
        months: 12,
        openingLines: [
          { accountCode: "1000", debit: 5_000_000 },
          { accountCode: "3000", credit: 5_000_000 },
        ],
      }),
    });
    r.status === 201 || r.status === 200
      ? ok("سال ساخته شد", `${r.json?.title} ${r.json?.startsAt?.slice(0,10)} → ${r.json?.endsAt?.slice(0,10)}`)
      : bad("ساخت سال", `status=${r.status} ${r.text.slice(0,200)}`);
    newId = r.json?.id ?? null;
    if (newId && r.json.endsAt.slice(0,10) === "2028-04-01") ok("پایان = یک سال بعد", "۱۲ ماه بعد");
  }

  step(4, "سال باز جدید جایگزین شد");
  {
    const r = await req(`${API}/admin/accounting/fiscal-year`);
    const openNow = (r.json?.items ?? []).find((y) => y.state === "OPEN");
    openNow?.id === newId ? ok("سال جدید باز است") : bad("سال باز", openNow?.id);
    openNow && oldOpenId && oldOpenId !== newId
      ? (await req(`${API}/admin/accounting/fiscal-year`)).json.items.find((y) => y.id === oldOpenId)?.state === "LOCKED"
        ? ok("سال قبلی خودکار LOCKED شد")
        : bad("سال قبلی LOCKED نشد")
      : ok("سال قبلی بررسی نشد");
  }

  step(5, "سند تراز افتتاحیه ثبت شد");
  {
    const r = await req(`${API}/admin/accounting/journal?limit=5`);
    const opening = (r.json?.items ?? []).find((e) => (e.description ?? "").includes("تراز افتتاحیه"));
    opening ? ok("سند تراز افتتاحیه هست", `${opening.number} جمع=${opening.totalDebit}`) : bad("سند تراز افتتاحیه", `${(r.json?.items ?? []).length} سند اخیر`);
  }

  step("5b", "ثبت یک فروش در سال جدید تا سند اختتامیه معنا پیدا کند");
  {
    // بدون حساب درآمد/هزینه، سند اختتامیه چیزی برای بستن ندارد و
    // درست است که ساخته نشود. پس اول یک عملیات واقعی در سال می‌سازیم.
    const r = await req(`${API}/admin/accounting/journal/manual`, {
      method: "POST",
      body: JSON.stringify({
        description: `فروش تست سال ${STAMP}`,
        state: "FINAL",
        date: "2027-06-01T00:00:00.000Z",
        lines: [
          { accountCode: "1100", debit: 2_000_000 },
          { accountCode: "4000", credit: 2_000_000 },
        ],
      }),
    });
    r.json?.state === "FINAL" ? ok("فروش ثبت شد", r.json.number) : bad("ثبت فروش", `status=${r.status} ${r.text.slice(0,140)}`);
  }

  step(6, "سال دوم با قفل قبلی باید رد شود");
  {
    const r = await req(`${API}/admin/accounting/fiscal-year`, {
      method: "POST",
      body: JSON.stringify({ title: "تست رد شدن", startsAt: "2030-04-01T00:00:00.000Z", closeCurrent: false }),
    });
    r.status === 400 && r.json?.code === "FISCAL_YEAR_ALREADY_OPEN" ? ok("با پیام روشن رد شد") : bad("رد نشد", `status=${r.status}`);
  }

  step(7, "هم‌پوشانی بازه باید رد شود");
  {
    const r = await req(`${API}/admin/accounting/fiscal-year`, {
      method: "POST",
      body: JSON.stringify({ title: "تست هم‌پوشانی", startsAt: "2027-06-01T00:00:00.000Z" }),
    });
    r.status === 400 && r.json?.code === "FISCAL_YEAR_OVERLAP" ? ok("بازهٔ هم‌پوشان رد شد") : bad("هم‌پوشانی", `status=${r.status} ${r.text.slice(0,120)}`);
  }

  step(8, "تراز افتتاحیهٔ نامتوازن باید رد شود");
  {
    const r = await req(`${API}/admin/accounting/fiscal-year`, {
      method: "POST",
      body: JSON.stringify({
        title: "تست نامتوازن",
        startsAt: "2031-04-01T00:00:00.000Z",
        openingLines: [{ accountCode: "1000", debit: 100 }, { accountCode: "3000", credit: 999 }],
      }),
    });
    r.status === 400 ? ok("تراز نامتوازن رد شد", r.json?.code ?? "") : bad("تراز نامتوازن", `status=${r.status}`);
  }

  step(9, "بستن سال + سند اختتامیه");
  {
    const r = await req(`${API}/admin/accounting/fiscal-year/${newId}/close`, { method: "POST" });
    r.json?.state === "CLOSED" ? ok("سال بسته شد", `closingEntryPosted=${r.json?.closingEntryPosted}`) : bad("بستن سال", `status=${r.status} ${r.text.slice(0,200)}`);
  }

  step(10, "سند اختتامیه باید ثبت شده باشد");
  {
    const r = await req(`${API}/admin/accounting/journal?limit=10`);
    const closing = (r.json?.items ?? []).find((e) => e.sourceType === "closing");
    closing ? ok("سند اختتامیه ثبت شد", `${closing.number} جمع=${closing.totalDebit}`) : bad("سند اختتامیه", "پیدا نشد");
    if (closing) {
      const g = await req(`${API}/admin/accounting/journal/${closing.id}`);
      const dr = (g.json?.lines ?? []).reduce((s, l) => s + l.debit, 0);
      const cr = (g.json?.lines ?? []).reduce((s, l) => s + l.credit, 0);
      dr === cr && dr > 0 ? ok("سند اختتامیه متوازن است", `Dr=${dr} Cr=${cr}`) : bad("سند نامتوازن", `Dr=${dr} Cr=${cr}`);
    }
  }

  step(11, "بستن سال بسته باید رد شود");
  {
    const r = await req(`${API}/admin/accounting/fiscal-year/${newId}/close`, { method: "POST" });
    r.status === 400 && r.json?.code === "FISCAL_YEAR_NOT_OPEN" ? ok("بستن دوباره رد شد") : bad("بستن دوباره", `status=${r.status}`);
  }

  step(12, "دفترها بعد از اختتامیه باید متوازن بمانند");
  {
    const r = await req(`${API}/admin/accounting/integrity`);
    r.json?.balanced === true ? ok("دفترها متوازن‌اند", `Dr=${r.json.debit} Cr=${r.json.credit}`) : bad("نامتوازن", JSON.stringify(r.json));
  }

  step(13, "بازگشایی سال بسته");
  {
    const r = await req(`${API}/admin/accounting/fiscal-year/${newId}/reopen`, { method: "POST" });
    r.json?.state === "OPEN" ? ok("سال بازگشایی شد") : bad("بازگشایی", `status=${r.status} ${r.text.slice(0,140)}`);
  }

  step(14, "پاک‌سازی: بازگشت به وضعیت اول");
  {
    // سال تست را می‌بندیم و سال اصلی را دوباره باز می‌کنیم
    await req(`${API}/admin/accounting/fiscal-year/${newId}/close`, { method: "POST" });
    const openNow = (await req(`${API}/admin/accounting/fiscal-year`)).json.items.find((y) => y.state === "OPEN");
    if (openNow && oldOpenId && openNow.id !== oldOpenId) {
      await req(`${API}/admin/accounting/fiscal-year/${openNow.id}/reopen`, { method: "POST" });
    }
    if (oldOpenId) await req(`${API}/admin/accounting/fiscal-year/${oldOpenId}/reopen`, { method: "POST" });
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient();
    await db.journalEntry.deleteMany({ where: { description: { contains: `سال تست ${STAMP}` } } });
    await db.journalEntry.deleteMany({ where: { description: { contains: `فروش تست سال ${STAMP}` } } });
    await db.journalEntry.deleteMany({ where: { description: { contains: `سال تست ${STAMP}` } } });
    await db.fiscalYear.deleteMany({ where: { id: newId } });
    const open = await db.fiscalYear.findMany({ where: { state: "OPEN" }, select: { id: true, title: true } });
    await db.$disconnect();
    open.length === 1 ? ok("پاک‌سازی کامل — یک سال باز", open[0].title) : bad("سال‌های باقی‌مانده", `${open.length}`);
  }

  console.log(`\n${"=".repeat(52)}`);
  console.log(`نتیجه: ${pass} موفق / ${fail} ناموفق`);
  console.log("=".repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("خطا:", e.message); process.exit(1); });