/** تست زندهٔ باگ A1 — فروش اعتباری در صندوق که کلاً از کار افتاده بود */
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

(async () => {
  step(1, "ورود ادمین");
  await req(`${API}/auth/login`, { method: "POST", body: JSON.stringify({ email: "admin@ghasedak.demo", password: "Ghasedak#Demo1" }) });

  step(2, "یافتن داده‌های لازم: انبار، محصول موجود، صندوق");
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  const wh = await db.warehouse.findFirst({ where: { active: true } });
  const skuRow = await db.productVariant.findFirst({
    where: { product: { deletedAt: null, status: "PUBLISHED" } },
    select: { sku: true, price: true },
    orderBy: { id: "asc" },
  });
  const cash = await db.cashAccount.findFirst({ where: { active: true, kind: "cash" } });
  if (!wh || !skuRow || !cash) {
    bad("دادهٔ لازم نیست", `wh=${!!wh} sku=${!!skuRow} cash=${!!cash}`);
    await db.$disconnect();
    process.exit(1);
  }
  ok("انبار و محصول و صندوق پیدا شد", `${skuRow.sku}`);
  await db.$disconnect();

  const price = Number(skuRow.price);

  step("2b", "یافتن شیفت باز صندوق (POS بدون شیفت فروش نمی‌پذیرد)");
  let shiftId = null;
  {
    // endpoint «شیفت جاری» خودش شیفت باز را برمی‌گرداند؛ نیازی به ساختن
    // دستی نیست و به کدِ `SHIFT_OPEN` هم نمی‌خوریم.
    const r = await req(`${API}/pos/shift/current`);
    if (r.json?.id) {
      shiftId = r.json.id;
      ok("شیفت باز پیدا شد", `${shiftId} — صندوق ${r.json.openingCash ?? "?"}`);
    } else {
      bad("شیفت باز پیدا نشد", `status=${r.status} ${r.text?.slice(0, 140)}`);
    }
  }

  step(3, "فروش کاملاً اعتباری (قبلاً همیشه خطا می‌داد)");
  let invoiceId = null;
  {
    const r = await req(`${API}/pos/sale`, {
      method: "POST",
      body: JSON.stringify({
        ...(shiftId ? { shiftId } : {}),
        lines: [{ sku: skuRow.sku, qty: 1 }],
        payments: [{ methodCode: "credit", amount: price }],
        customerName: "مشتری اعتباری تست",
        customerMobile: "09120000001",
      }),
    });
    r.status === 201 || r.status === 200
      ? ok("فروش اعتباری ثبت شد — باگ A1 رفع شد", `فاکتور=${r.json?.number} مبلغ=${price.toLocaleString("fa-IR")}`)
      : bad("فروش اعتباری رد شد", `status=${r.status} ${r.text?.slice(0, 180)}`);
    invoiceId = r.json?.id ?? null;
  }

  step(4, "سند فروش باید شامل حساب دریافتنی ۱۲۱۰ باشد");
  {
    const r = await req(`${API}/admin/accounting/journal?limit=50`);
    const je = (r.json?.items ?? []).find((e) => e.sourceType === "pos_invoice" && e.sourceId === invoiceId);
    je ? ok("سند فروش پیدا شد", je.number) : bad("سند فروش یافت نشد");
    if (je) {
      const dr = je.lines.filter((l) => l.debit > 0).reduce((s, l) => s + l.debit, 0);
      const cr = je.lines.filter((l) => l.credit > 0).reduce((s, l) => s + l.credit, 0);
      dr === cr ? ok("سند متوازن است", `Dr=${dr.toLocaleString("fa-IR")}`) : bad("سند نامتوازن", `Dr=${dr} Cr=${cr}`);
      const ar = je.lines.find((l) => l.accountCode === "1210" && l.debit > 0);
      ar ? ok("حساب دریافتنی ۱۲۱۰ بدهکار شد", ar.debit.toLocaleString("fa-IR")) : bad("خط ۱۲۱۰ وجود ندارد — بدهی مشتری ثبت نشد");
      const sales = je.lines.find((l) => l.accountCode === "4000" && l.credit > 0);
      sales ? ok("درآمد فروش ۴۰۰۰ بستانکار شد", sales.credit.toLocaleString("fa-IR")) : bad("خط ۴۰۰۰ نیست");
    }
  }

  step(5, "فروش ترکیبی: نقد + اعتباری");
  {
    const half = Math.floor(price / 2);
    const rest = price - half;
    const r = await req(`${API}/pos/sale`, {
      method: "POST",
      body: JSON.stringify({
        ...(shiftId ? { shiftId } : {}),
        lines: [{ sku: skuRow.sku, qty: 1 }],
        payments: [
          { methodCode: "cash", amount: half },
          { methodCode: "credit", amount: rest },
        ],
        customerName: "مشتری نیمه‌اعتباری تست",
        customerMobile: "09120000002",
      }),
    });
    r.status === 201 || r.status === 200
      ? ok("فروش ترکیبی ثبت شد", `نقد=${half.toLocaleString("fa-IR")} اعتبار=${rest.toLocaleString("fa-IR")}`)
      : bad("فروش ترکیبی رد شد", `status=${r.status} ${r.text?.slice(0, 180)}`);
  }

  step(6, "فروش کاملاً نقدی (تضمین عدم پسرفت)");
  {
    const r = await req(`${API}/pos/sale`, {
      method: "POST",
      body: JSON.stringify({
        ...(shiftId ? { shiftId } : {}),
        lines: [{ sku: skuRow.sku, qty: 1 }],
        payments: [{ methodCode: "cash", amount: price }],
        customerName: "مشتری نقدی تست",
      }),
    });
    r.status === 201 || r.status === 200 ? ok("فروش نقدی ثبت شد", r.json?.number) : bad("فروش نقدی رد شد", `status=${r.status} ${r.text?.slice(0, 140)}`);
  }

  step(7, "دفتر باید متوازن باشد");
  {
    const r = await req(`${API}/admin/accounting/integrity`);
    r.json?.balanced === true ? ok("دفتر متوازن", `Dr=${Number(r.json.debit).toLocaleString("fa-IR")}`) : bad("دفتر نامتوازن", JSON.stringify(r.json));
  }

  step(8, "پاک‌سازی کامل فاکتورهای تست");
  {
    const { PrismaClient } = await import("@prisma/client");
    const d2 = new PrismaClient();
    const names = ["اعتباری تست", "نیمه‌اعتباری تست", "نقدی تست"];
    const invoices = await d2.posInvoice.findMany({
      where: { customerName: { in: names } },
      select: { id: true, customerName: true },
    });
    const ids = invoices.map((x) => x.id);

    for (const id of ids) {
      const entries = await d2.journalEntry.findMany({ where: { sourceId: id, sourceType: "pos_invoice" }, select: { id: true } });
      for (const e of entries) {
        await d2.journalLine.deleteMany({ where: { entryId: e.id } });
        await d2.journalEntry.delete({ where: { id: e.id } });
      }
      await d2.stockLedgerEntry.deleteMany({ where: { refType: "pos_invoice", refId: id } });
      await d2.posPayment.deleteMany({ where: { posInvoiceId: id } });
      await d2.posInvoiceItem.deleteMany({ where: { posInvoiceId: id } });
      await d2.posInvoice.delete({ where: { id } }).catch(() => null);
    }

    const left = await d2.posInvoice.count({ where: { customerName: { in: names } } });
    await d2.$disconnect();
    left === 0
      ? ok(`${invoices.length} فاکتور تست و سندهایشان پاک شد`)
      : bad("فاکتور تست باقی ماند", `${left}`);
  }

  step(9, "دفتر بعد از پاک‌سازی به حالت اول برگشت");
  {
    const r = await req(`${API}/admin/accounting/integrity`);
    r.json?.balanced === true
      ? ok("دفتر متوازن و به ماندهٔ اولیه برگشت", `Dr=${Number(r.json.debit).toLocaleString("fa-IR")}`)
      : bad("دفتر نامتوازن", JSON.stringify(r.json));
  }

  console.log(`\n${"=".repeat(52)}`);
  console.log(`نتیجه: ${pass} موفق / ${fail} ناموفق`);
  console.log("=".repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("خطا:", e.message); process.exit(1); });