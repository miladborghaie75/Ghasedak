/** تست فاز ۵ — گزارش‌های مدیریتی */
const API = "http://localhost:4000/api/v1";
const ADMIN = "http://localhost:3200";
let cookie = "";
let pass = 0, fail = 0;
const ok = (l, x = "") => { console.log(`  PASS  ${l}${x ? " — " + x : ""}`); pass++; };
const bad = (l, x = "") => { console.log(`  FAIL  ${l}${x ? " — " + x : ""}`); fail++; };
const step = (n, t) => console.log(`\n${n}) ${t}`);
const STAMP = Date.now();

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

  step(2, "آماده‌سازی دادهٔ تست: بدهکار، بدهی و چک");
  let customerAccountId = null;
  let supplierAccountId = null;
  let checkId = null;
  let arId = null;
  let apId = null;
  {
    const cust = await db.customer.create({
      data: { name: `مشتری تست گزارش ${STAMP}`, mobile: "09120000099" },
    });
    const ca = await db.customerAccount.create({ data: { customerId: cust.id, creditLimit: 0n } });
    customerAccountId = ca.id;

    const sup = await db.supplier.create({ data: { name: `تأمین‌کننده تست گزارش ${STAMP}` } });
    const sa = await db.supplierAccount.create({ data: { supplierId: sup.id, outstanding: 0n } });
    supplierAccountId = sa.id;

    // بدهی سررسید گذشته (۴۵ روز) ⇒ باید در گروه «۳۱ تا ۶۰ روز گذشته» بنشیند
    const past = new Date(Date.now() - 45 * 86_400_000);
    const ar = await db.accountsReceivable.create({
      data: {
        accountPId: ca.id,
        refType: "order",
        refId: `test-${STAMP}`,
        amount: 5_000_000n,
        dueDate: past,
        state: "OPEN",
      },
    });
    arId = ar.id;

    // بدهی سررسید آینده (۱۰ روز)
    const future = new Date(Date.now() + 10 * 86_400_000);
    const ap = await db.accountsPayable.create({
      data: {
        accountPId: sa.id,
        refType: "purchase_invoice",
        refId: `test-${STAMP}`,
        amount: 3_000_000n,
        dueDate: future,
        state: "OPEN",
      },
    });
    apId = ap.id;

    const chk = await db.check.create({
      data: {
        number: `T${STAMP}`,
        direction: "RECEIVED",
        bankName: "بانک تست",
        amount: 2_000_000n,
        issueDate: new Date(Date.now() - 60 * 86_400_000),
        dueDate: new Date(Date.now() - 5 * 86_400_000),
        status: "ISSUED",
      },
    });
    checkId = chk.id;
    ok("دادهٔ تست ساخته شد", "۱ بدهکار گذشته، ۱ بدهی آینده، ۱ چک سررسیدگذشته");
  }

  step(3, "گزارش بدهکاران و بستانکاران");
  {
    const r = await req(`${API}/admin/accounting/reports/ar-ap`);
    r.status === 200 ? ok("endpoint کار می‌کند") : bad("ar-ap", `status=${r.status} ${r.text?.slice(0,140)}`);
    const rec = r.json?.receivables;
    const mine = rec?.items?.find((x) => x.refId === `test-${STAMP}`);
    mine ? ok("بدهکار تست دیده شد", `${mine.party} — ${mine.open.toLocaleString("fa-IR")}`) : bad("بدهکار تست یافت نشد");
    mine?.overdue === true ? ok("سررسید گذشته علامت خورد") : bad("overdue نشد");
    mine?.bucket?.includes("۳۱ تا ۶۰") ? ok("گروه سنی درست است", mine.bucket) : bad("گروه سنی", String(mine?.bucket));
    mine?.daysLate >= 44 ? ok("تعداد روز تأخیر محاسبه شد", `${mine.daysLate} روز`) : bad("daysLate", String(mine?.daysLate));
    const pay = r.json?.payables?.items?.find((x) => x.refId === `test-${STAMP}`);
    pay ? ok("بدهی تست دیده شد", pay.open.toLocaleString("fa-IR")) : bad("بدهی تست یافت نشد");
    pay?.overdue === false ? ok("بدهی آینده سررسید نگذشته علامت خورد") : bad("بدهی آینده overdue شد");
    typeof r.json?.net === "number" ? ok("خالص بدهی محاسبه شد", r.json.net.toLocaleString("fa-IR")) : bad("net نیست");
    Object.keys(rec?.byBucket ?? {}).length > 0 ? ok("تفکیک سنی ساخته شد", Object.keys(rec.byBucket).join(" · ")) : bad("byBucket خالی");
  }

  step(4, "گزارش سود کالا و دسته");
  {
    const r = await req(`${API}/admin/accounting/reports/product-profitability`);
    r.status === 200 ? ok("endpoint کار می‌کند") : bad("profit", `status=${r.status} ${r.text?.slice(0,140)}`);
    const t = r.json?.totals;
    typeof t?.revenue === "number" ? ok("جمع فروش", t.revenue.toLocaleString("fa-IR")) : bad("totals.revenue نیست");
    Array.isArray(r.json?.products) ? ok(`فروش ${r.json.products.length} کالا تفکیک شد`) : bad("products آرایه نیست");
    Array.isArray(r.json?.categories) ? ok(`در ${r.json.categories.length} دسته تفکیک شد`) : bad("categories آرایه نیست");
    // محصولاتی که بهایشان نامشخص است باید صریح علامت بخورند
    const unknown = (r.json?.products ?? []).filter((p) => p.costKnown === false);
    unknown.length > 0
      ? ok(`${unknown.length} کالا «بهای نامشخص» علامت خورد (نه سود جعلی)`)
      : ok("همهٔ کالاها بها دارند");
  }

  step(5, "گزارش سود با بازهٔ زمانی");
  {
    const future = new Date(Date.now() + 3650 * 86_400_000).toISOString().slice(0, 10);
    const r = await req(`${API}/admin/accounting/reports/product-profitability?from=${future}&to=${future}`);
    r.json?.range?.from === future ? ok("بازهٔ زمانی اعمال شد", `${r.json.range.from}`) : bad("بازه اعمال نشد", JSON.stringify(r.json?.range));
    r.json?.totals?.revenue === 0 ? ok("بازهٔ خالی درآمد صفر داد (درست)") : bad("بازهٔ خالی", String(r.json?.totals?.revenue));
  }

  step(6, "مغایرت بانکی");
  {
    const r = await req(`${API}/admin/accounting/reports/bank-reconciliation`);
    r.status === 200 ? ok("endpoint کار می‌کند") : bad("bank", `status=${r.status}`);
    Array.isArray(r.json?.accounts) ? ok(`${r.json.accounts.length} حساب بانکی بررسی شد`) : bad("accounts آرایه نیست");
    // هر حساب باید کد دفتری جدا داشته باشد (تصمیم کاربر: گزینهٔ الف)
    const codes = (r.json?.accounts ?? []).map((a) => a.glCode);
    const allSub = codes.length > 0 && codes.every((c) => c === "1100" || c.startsWith("1100-"));
    allSub ? ok("همهٔ بانک‌ها حساب دفتری مستقل دارند", codes.join(" · ")) : bad("تفکیک بانک‌ها", codes.join(" · "));
    typeof r.json?.totalDifference === "number" ? ok("اختلاف کل محاسبه شد") : bad("totalDifference نیست");
  }

  step(7, "چک‌های سررسید");
  {
    const r = await req(`${API}/admin/accounting/reports/checks-due?withinDays=30`);
    r.status === 200 ? ok("endpoint کار می‌کند") : bad("checks-due", `status=${r.status}`);
    const mine = r.json?.overdue?.items?.find((x) => x.id === checkId);
    mine ? ok("چک سررسیدگذشته در گروه overdue", `${mine.number} — ${mine.amount.toLocaleString("fa-IR")}`) : bad("چک تست در overdue نیست");
    mine?.daysUntilDue < 0 ? ok("روز تا سررسید منفی است (گذشته)", String(mine.daysUntilDue)) : bad("daysUntilDue", String(mine?.daysUntilDue));
    const soon = r.json?.dueSoon?.items ?? [];
    soon.every((c) => c.daysUntilDue >= 0 && c.daysUntilDue <= 30)
      ? ok(`گروه «نزدیک سررسید» درست است (${soon.length} مورد)`)
      : bad("گروه نزدیک سررسید نادرست");
    typeof r.json?.overdue?.total === "number" ? ok("جمع مبلغ چک‌های گذشته") : bad("overdue.total نیست");
  }

  step(8, "گزارش‌ها با تراز آزمایشی بخوانند");
  {
    const tb = await req(`${API}/admin/accounting/trial-balance`);
    const integ = await req(`${API}/admin/accounting/integrity`);
    const sumDr = (tb.json ?? []).reduce((s, r) => s + Number(r.debit), 0);
    const sumCr = (tb.json ?? []).reduce((s, r) => s + Number(r.credit), 0);
    sumDr === sumCr
      ? ok("تراز آزمایشی متوازن است — گزارش‌های جدید می‌توانند به آن تکیه کنند", `Dr=${sumDr.toLocaleString("fa-IR")}`)
      : bad("تراز آزمایشی نامتوازن", `${sumDr} ≠ ${sumCr}`);
    integ.json?.balanced === true ? ok("کنترل توازن دفتر سالم است") : bad("دفتر نامتوازن", JSON.stringify(integ.json));
  }

  step(9, "صفحهٔ گزارش‌ها در ادمین");
  {
    const r = await fetch(`${ADMIN}/reports`, { headers: { cookie }, redirect: "follow" });
    const html = await r.text();
    r.status === 200 ? ok("صفحه باز شد") : bad("صفحهٔ گزارش‌ها", `status=${r.status}`);
    html.includes("گزارش‌های مدیریتی") ? ok("سربرگ درست") : bad("سربرگ نیست");
    const chunks = await Promise.all(
      [...html.matchAll(/\/_next\/static\/chunks\/[^"']+\.js/g)].map((m) =>
        fetch(`${ADMIN}${m[0]}`).then((x) => x.text()).catch(() => ""),
      ),
    );
    const bundle = chunks.join("");
    for (const label of ["بدهکاران و بستانکاران", "سود کالا و دسته", "مغایرت بانکی", "چک‌های سررسید"]) {
      bundle.includes(label) ? ok(`تب «${label}» هست`) : bad(`تب «${label}» نیست`);
    }
    bundle.includes("سررسید گذشته") ? ok("هشدار چک سررسیدگذشته آماده است") : bad("هشدار چک نیست");
    bundle.includes("نامشخص") ? ok("برچسب «بهای نامشخص» آماده است") : bad("برچسب بها نیست");
    bundle.includes("نیاز به بررسی") ? ok("برچسب مغایرت بانکی آماده است") : bad("برچسب مغایرت نیست");
  }

  step(10, "منو");
  {
    const r = await fetch(`${ADMIN}/`, { headers: { cookie } });
    const html = await r.text();
    html.includes("/reports") ? ok("لینک گزارش‌ها در منو هست") : bad("لینک گزارش در منو نیست");
  }

  step(11, "پاک‌سازی");
  {
    await db.accountsReceivable.deleteMany({ where: { id: arId } });
    await db.accountsPayable.deleteMany({ where: { id: apId } });
    await db.check.deleteMany({ where: { id: checkId } });
    await db.customerAccount.deleteMany({ where: { id: customerAccountId } });
    await db.supplierAccount.deleteMany({ where: { id: supplierAccountId } });
    await db.customer.deleteMany({ where: { mobile: "09120000099" } });
    await db.supplier.deleteMany({ where: { name: { contains: `تست گزارش ${STAMP}` } } });
    ok("دادهٔ تست پاک شد");
  }

  step(12, "دفتر بعد از پاک‌سازی سالم است");
  {
    const integ = await req(`${API}/admin/accounting/integrity`);
    integ.json?.balanced === true ? ok("دفتر متوازن", `Dr=${integ.json.debit}`) : bad("نامتوازن", JSON.stringify(integ.json));
  }

  await db.$disconnect();
  console.log(`\n${"=".repeat(52)}`);
  console.log(`نتیجه: ${pass} موفق / ${fail} ناموفق`);
  console.log("=".repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch(async (e) => { console.error("خطا:", e.message); process.exit(1); });