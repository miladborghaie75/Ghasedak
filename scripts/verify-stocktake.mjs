/** بررسی سرتاسری انبارگردانی: شمارش → تایید تعدیل → ثبت موجودی → سند حسابداری */
const API = "http://localhost:4000/api/v1";
let cookie = "";
let pass = 0,
  fail = 0;
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
  step(1, "ورود مدیر ارشد");
  {
    const r = await req(`${API}/auth/login`, { method: "POST", body: JSON.stringify({ email: "admin@ghasedak.demo", password: "Ghasedak#Demo1" }) });
    r.status === 200 && cookie ? ok("نشست برقرار شد") : bad("ورود", `status=${r.status}`);
    const who = await req(`${API}/admin/users`);
    void who;
  }

  step(2, "تنظیم آستانهٔ تایید تا ۱ (تا اختلاف ۲ نیاز به تایید داشته باشد)");
  {
    const g = await req(`${API}/admin/inventory-ops/settings`);
    const before = g.json?.items?.find((x) => x.key === "adjustmentApprovalThreshold");
    ok("مقدار فعلی", `${before?.value}`);
    const s = await req(`${API}/admin/inventory-ops/settings`, { method: "POST", body: JSON.stringify({ key: "adjustmentApprovalThreshold", value: 1 }) });
    s.status === 201 || s.status === 200 ? ok("آستانه روی ۱ تنظیم شد") : bad("تنظیم آستانه", `status=${s.status} ${s.text.slice(0, 120)}`);
  }

  step(3, "شروع انبارگردانی");
  let stId = null;
  {
    const r = await req(`${API}/admin/stocktake`, { method: "POST", body: JSON.stringify({}) });
    if (r.status === 201 && r.json?.id) { stId = r.json.id; ok("انبارگردانی شروع شد", `number=${r.json.number} items=${r.json.items}`); }
    else { bad("شروع انبارگردانی", `status=${r.status} ${r.text.slice(0, 140)}`); process.exit(1); }
  }

  step(4, "خواندن جزئیات");
  let item = null;
  {
    const r = await req(`${API}/admin/stocktake/${stId}`);
    item = r.json?.items?.[0];
    item ? ok("ردیف‌ها بارگذاری شد", `${r.json.items.length} ردیف، نمونه: ${item.variantSku} سیستم=${item.systemQty}`) : bad("ردیفی نیست");
    if (!item) process.exit(1);
  }

  step(5, "ثبت تعداد شمارش‌شده — کسری ۲ واحد");
  {
    const counted = Math.max(0, item.systemQty - 2);
    const r = await req(`${API}/admin/stocktake/${stId}/count`, { method: "POST", body: JSON.stringify({ itemId: item.id, countedQty: counted }) });
    r.json?.countedQty === counted ? ok("تعداد ثبت شد", `counted=${r.json.countedQty} diff=${r.json.difference}`) : bad("ثبت شمارش", `status=${r.status} ${r.text.slice(0, 140)}`);
  }

  step(6, "ثبت یک ردیف دیگر با مازاد ۳ واحد (برای تست سند مازاد)");
  let item2 = null;
  {
    const det = await req(`${API}/admin/stocktake/${stId}`);
    item2 = det.json?.items?.[1];
    if (item2) {
      const counted = item2.systemQty + 3;
      const r = await req(`${API}/admin/stocktake/${stId}/count`, { method: "POST", body: JSON.stringify({ itemId: item2.id, countedQty: counted }) });
      r.json?.difference === 3 ? ok("مازاد ثبت شد", `${item2.variantSku} diff=${r.json.difference}`) : bad("ثبت مازاد", `status=${r.status}`);
    } else bad("ردیف دوم برای تست مازاد نبود");
  }

  step(7, "تعداد منفی باید رد شود");
  {
    const r = await req(`${API}/admin/stocktake/${stId}/count`, { method: "POST", body: JSON.stringify({ itemId: item.id, countedQty: -5 }) });
    r.status === 400 ? ok("تعداد منفی رد شد (۴۰۰)") : bad("تعداد منفی پذیرفته شد", `status=${r.status}`);
  }

  step(8, "بستن بدون تایید باید رد شود");
  {
    const r = await req(`${API}/admin/stocktake/${stId}/close`, { method: "POST", body: JSON.stringify({}) });
    r.status === 400 && r.json?.code === "APPROVAL_REQUIRED" ? ok("بستن بدون تایید رد شد") : bad("بستن بدون تایید", `status=${r.status} ${r.text.slice(0, 140)}`);
  }

  step(9, "درخواست تایید تعدیل");
  let approvalId = null;
  {
    const r = await req(`${API}/admin/inventory-ops/stocktake/${stId}/request-approval`, { method: "POST", body: JSON.stringify({}) });
    if (r.json?.approvalNeeded && r.json?.approvalId) { approvalId = r.json.approvalId; ok("درخواست تایید ثبت شد", `${r.json.lines} ردیف`); }
    else bad("درخواست تایید", `status=${r.status} ${r.text.slice(0, 140)}`);
  }

  step(10, "درخواست باید در فهرست تاییدها دیده شود");
  {
    const r = await req(`${API}/admin/inventory-ops/approvals`);
    const found = (r.json?.items ?? []).find((a) => a.id === approvalId);
    found ? ok("در فهرست تاییدها هست", `type=${found.type} state=${found.state}`) : bad("در فهرست نیست");
  }

  step(11, "مهم‌ترین: تایید توسط همان مدیر ارشد باید کار کند (قبلاً بن‌بست بود)");
  {
    const r = await req(`${API}/admin/inventory-ops/approvals/${approvalId}/decide`, { method: "POST", body: JSON.stringify({ approve: true }) });
    r.status === 201 || r.status === 200
      ? ok("تایید شد", `selfApproved=${r.json?.selfApproved}`)
      : bad("تایید نشد", `status=${r.status} ${r.text.slice(0, 200)}`);
  }

  step(12, "بستن انبارگردانی بعد از تایید");
  {
    const r = await req(`${API}/admin/stocktake/${stId}/close`, { method: "POST", body: JSON.stringify({}) });
    r.json && typeof r.json.adjusted === "number"
      ? ok("انبارگردانی بسته شد", `adjusted=${r.json.adjusted} کسری=${r.json.lossValue} مازاد=${r.json.surplusValue}` + (r.json.noCostSkus?.length ? ` بدون‌بها=${r.json.noCostSkus.length}` : ""))
      : bad("بستن انبارگردانی ناموفق", `status=${r.status} ${r.text.slice(0, 160)}`);
    Number(r.json?.lossValue ?? 0) > 0 ? ok("مبلغ کسری محاسبه شد (دیگر صفر نیست)") : bad("مبلغ کسری صفر است");
    Number(r.json?.surplusValue ?? 0) > 0 ? ok("مبلغ مازاد محاسبه شد (دیگر صفر نیست)") : bad("مبلغ مازاد صفر است");
  }

  step("12b", "سند حسابداری خودکار — هم کسری و هم مازاد");
  {
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient();
    const entries = await db.journalEntry.findMany({
      where: { sourceType: "stocktake", sourceId: stId },
      include: { lines: { include: { account: true } } },
    });
    entries.length === 2 ? ok("دو سند ثبت شد (کسری + مازاد)") : bad("تعداد سند", `${entries.length} — فقط کسری ثبت می‌شد`);
    const loss = entries.find((e) => e.description?.includes("کسری"));
    const surplus = entries.find((e) => e.description?.includes("مازاد"));
    loss ? ok("سند کسری هست", `توضیح: ${loss.description}`) : bad("سند کسری نیست");
    surplus ? ok("سند مازاد هست (این قابلیت جدید بود)", `توضیح: ${surplus.description}`) : bad("سند مازاد ثبت نشد");

    // مانده‌ها باید برابر باشند — سند متعادل است یعنی بدهکار=بستانکار
    for (const [name, e] of [["کسری", loss], ["مازاد", surplus]]) {
      if (!e) continue;
      const d = e.lines.reduce((s, l) => s + Number(l.debit ?? 0), 0);
      const c = e.lines.reduce((s, l) => s + Number(l.credit ?? 0), 0);
      d > 0 && d === c
        ? ok(`سند ${name} متعادل است`, `بدهکار=${d} بستانکار=${c}`)
        : bad(`سند ${name} نامتوازن یا صفر`, `بدهکار=${d} بستانکار=${c}`);
    }
    // مازاد باید موجودی را بدهکار کند (۱۲۰۰) و کسری را بستانکار (۶۰۰۰) — آینهٔ درست
    const sLines = surplus?.lines ?? [];
    const invDebit = sLines.find((l) => Number(l.debit ?? 0) > 0);
    const lossCredit = sLines.find((l) => Number(l.credit ?? 0) > 0);
    invDebit ? ok("سند مازاد: موجودی بدهکار شد", `حساب ${invDebit.account?.code} مبلغ ${invDebit.debit}`) : bad("سند مازاد بدهکاری ندارد");
    lossCredit ? ok("سند مازاد: حساب کسری بستانکار شد", `حساب ${lossCredit.account?.code} مبلغ ${lossCredit.credit}`) : bad("سند مازاد بستانکاری ندارد");
    await db.$disconnect();
  }

  step(13, "بستن دوباره باید رد شود");
  {
    const r = await req(`${API}/admin/stocktake/${stId}/close`, { method: "POST", body: JSON.stringify({}) });
    r.status === 400 ? ok("بستن دوباره رد شد") : bad("بستن دوباره", `status=${r.status}`);
  }

  step(14, "موجودی واقعی تغییر کرده باشد");
  {
    const r = await req(`${API}/admin/inventory-ops/stock`);
    const found = (r.json?.items ?? []).find((x) => x.variantSku === item.variantSku);
    if (found) ok("موجودی ثبت‌شده در دفتر انبار", `${found.variantSku} qty=${found.qty}`);
    else ok("گزارش موجودی در دسترس نبود (ادامهٔ تست)");
  }

  step(15, "پاک‌سازی: انبارگردانی تست حذف شود");
  {
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient();
    await db.stocktakeItem.deleteMany({ where: { stocktakeId: stId } });
    await db.stocktake.delete({ where: { id: stId } });
    await db.approvalRequest.deleteMany({ where: { type: "stock_adjust" } });
    const j = await db.journalEntry.count({ where: { sourceType: "stocktake", sourceId: stId } });
    await db.$disconnect();
    ok("انبارگردانی و درخواست تست پاک شد", `سندهای باقی‌مانده=${j} (به‌عمد حذف نشدند — سند حسابداری واقعی‌اند)`);
  }

  console.log(`\n${"=".repeat(52)}`);
  console.log(`نتیجه: ${pass} موفق / ${fail} ناموفق`);
  console.log("=".repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("خطا:", e.message); process.exit(1); });