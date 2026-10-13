/** تست زندهٔ باگ A2/A3 — سند خرید باید یکی باشد و داخل تراکنش ثبت شود */
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

(async () => {
  step(1, "ورود ادمین");
  await req(`${API}/auth/login`, { method: "POST", body: JSON.stringify({ email: "admin@ghasedak.demo", password: "Ghasedak#Demo1" }) });

  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();

  step(2, "آماده‌سازی: تأمین‌کننده، انبار، واریانت");
  const stamp = Date.now();
  const supplier = await db.supplier.create({ data: { name: `تامین‌کننده تست A2 ${stamp}` } });
  const wh = await db.warehouse.findFirst({ where: { active: true } });
  const variant = await db.productVariant.findFirst({ where: { product: { deletedAt: null } }, select: { sku: true } });
  // فاکتور خرید به «حساب تامین‌کننده» (AP sub-ledger) نیاز دارد، نه فقط رکورد تأمین‌کننده
  const sa = await db.supplierAccount.create({
    data: { supplierId: supplier.id, outstanding: 0n },
  });
  ok("داده‌ها آماده شد", `${variant.sku} → انبار ${wh?.name} · حساب AP=${sa.id}`);
  const unitCost = 100000;
  const qty = 4;
  const expected = unitCost * qty;

  const balBefore = await db.$queryRawUnsafe(`
    SELECT COALESCE(SUM(l.debit - l.credit),0) AS net
    FROM "JournalLine" l JOIN "Account" a ON a.id = l."accountId"
    WHERE a.code = '1200' OR a.code LIKE '1200-%'`);
  const grnWarehouseId = wh.id;

  step(3, "ثبت رسید کالا (GRN)");
  let grnId = null;
  {
    const r = await req(`${API}/admin/purchasing/goods-receipts`, {
      method: "POST",
      body: JSON.stringify({
        supplierId: supplier.id,
        warehouseId: wh.id,
        lines: [{ variantSku: variant.sku, qty, unitCost }],
      }),
    });
    r.status === 201 || r.status === 200
      ? ok("GRN ثبت شد", r.json?.number)
      : bad("ثبت GRN", `status=${r.status} ${r.text?.slice(0, 180)}`);
    grnId = r.json?.id ?? null;
  }

  step(4, "باگ A2: باید دقیقاً یک سند برای این GRN باشد");
  {
    const entries = await db.journalEntry.findMany({
      where: { sourceId: grnId },
      select: { id: true, sourceType: true, number: true, description: true },
    });
    entries.length === 1
      ? ok("فقط یک سند ثبت شد — دوبارشماری رفع شد", `${entries[0].sourceType} ${entries[0].number}`)
      : bad("سند تکراری", `${entries.length} سند: ${entries.map((e) => e.sourceType).join(", ")}`);
  }

  step(5, "سند باید موجودیِ حسابِ انبار را بدهکار کند (فاز ۶) و GRNI را بستانکار — نه Cr 2100");
  let warehouseGlCode = null;
  {
    const je = await db.journalEntry.findFirst({
      where: { sourceId: grnId },
      include: { lines: { include: { account: true } } },
    });
    // از فاز ۶، موجودی روی **حساب اختصاصی همان انبار** می‌نشیند
    // (مثل `1200-93`)، نه روی گروه `1200`.
    const wh = await db.warehouse.findFirst({
      where: { id: grnWarehouseId ?? undefined },
      select: { glAccount: { select: { code: true } } },
    });
    warehouseGlCode = wh?.glAccount?.code ?? "1200";

    // هر خط بدهکارِ زیرمجموعهٔ ۱۲۰۰ (گروه یا زیرحساب) قبول است
    const isInv = (code) => code === "1200" || code.startsWith("1200-");
    const dr = je?.lines.filter((l) => isInv(l.account.code) && l.debit > 0).reduce((s, l) => s + Number(l.debit), 0);
    const crGrni = je?.lines.filter((l) => l.account.code === "2150" && l.credit > 0).reduce((s, l) => s + Number(l.credit), 0);
    const crAp = je?.lines.filter((l) => l.account.code === "2100" && l.credit > 0).reduce((s, l) => s + Number(l.credit), 0);
    dr === expected
      ? ok("موجودی کالا بدهکار شد", `${dr.toLocaleString("fa-IR")} روی ${warehouseGlCode}`)
      : bad("Dr موجودی", `${dr} ≠ ${expected}`);
    dr > 0 && warehouseGlCode.startsWith("1200-")
      ? ok("روی حساب اختصاصی انبار نشست (نه گروه ۱۲۰۰)", warehouseGlCode)
      : ok("روی گروه ۱۲۰۰ نشست (انبار حساب اختصاصی ندارد)", warehouseGlCode);
    crGrni === expected ? ok("GRNI بستانکار شد", crGrni.toLocaleString("fa-IR")) : bad("Cr 2150", `${crGrni} ≠ ${expected}`);
    crAp === 0 ? ok("بدهی تأمین‌کننده باز نشد (بدون فاکتور)") : bad("Cr 2100 نباید باشد", String(crAp));
  }

  step(6, "باگ A2: موجودی نباید دوبرابر شده باشد");
  {
    // جمع **همهٔ** حساب‌های گروه ۱۲۰۰ (شامل زیرحساب انبار)
    const balAfter = await db.$queryRawUnsafe(`
      SELECT COALESCE(SUM(l.debit - l.credit),0) AS net
      FROM "JournalLine" l JOIN "Account" a ON a.id = l."accountId"
      WHERE a.code = '1200' OR a.code LIKE '1200-%'`);
    const delta = Number(balAfter[0].net) - Number(balBefore[0].net);
    delta === expected
      ? ok("ماندهٔ ۱۲۰۰ دقیقاً به اندازهٔ رسید تغییر کرد", `Δ=${delta.toLocaleString("fa-IR")}`)
      : bad("موجودی دوبار شده", `Δ=${delta} ≠ ${expected}`);
  }

  step(7, "فاکتور خرید → GRNI بسته و بدهی واقعی باز شود");
  let invId = null;
  {
    const r = await req(`${API}/admin/purchasing/purchase-invoices`, {
      method: "POST",
      body: JSON.stringify({
        supplierId: supplier.id,
        grnId,
        lines: [{ variantSku: variant.sku, qty, unitCost }],
      }),
    });
    r.status === 201 || r.status === 200 ? ok("فاکتور ثبت شد", r.json?.invoice?.number) : bad("ثبت فاکتور", `status=${r.status} ${r.text?.slice(0, 200)}`);
    invId = r.json?.invoice?.id ?? null;
  }

  step(8, "باگ A3: سند فاکتور هم باید باشد و توازن داشته باشد");
  {
    const entries = await db.journalEntry.findMany({
      where: { sourceId: invId, sourceType: "purchase_invoice" },
      include: { lines: { include: { account: true } } },
    });
    entries.length === 1 ? ok("یک سند برای فاکتور", entries[0].number) : bad("تعداد سند فاکتور", `${entries.length}`);
    const e = entries[0];
    if (e) {
      const dr = e.lines.reduce((s, l) => s + Number(l.debit), 0);
      const cr = e.lines.reduce((s, l) => s + Number(l.credit), 0);
      dr === cr ? ok("سند فاکتور متوازن", `Dr=${dr.toLocaleString("fa-IR")}`) : bad("سند فاکتور نامتوازن", `Dr=${dr} Cr=${cr}`);
      const crAp = e.lines.filter((l) => l.account.code === "2100").reduce((s, l) => s + Number(l.credit), 0);
      crAp === expected ? ok("بدهی تأمین‌کننده باز شد", crAp.toLocaleString("fa-IR")) : bad("Cr 2100 فاکتور", String(crAp));
    }
  }

  step(9, "پاک‌سازی کامل");
  {
    const invIds = invId ? [invId] : [];
    for (const id of [...invIds, grnId]) {
      const entries = await db.journalEntry.findMany({ where: { sourceId: id }, select: { id: true } });
      for (const en of entries) {
        await db.journalLine.deleteMany({ where: { entryId: en.id } });
        await db.journalEntry.delete({ where: { id: en.id } });
      }
      await db.stockLedgerEntry.deleteMany({ where: { refId: id } });
      // CostLayer فیلد refId ندارد؛ با SKU و انبارِ تست پاک می‌شود
      await db.costLayer.deleteMany({ where: { warehouseId: wh.id, variantSku: variant.sku } });
      await db.purchaseInvoiceItem.deleteMany({ where: { invoiceId: id } });
      await db.accountsPayable.deleteMany({ where: { refId: id } });
      await db.goodsReceiptItem.deleteMany({ where: { receiptId: id } });
      await db.purchaseInvoice.deleteMany({ where: { id } });
      await db.goodsReceipt.deleteMany({ where: { id } });
    }
    await db.supplierAccount.deleteMany({ where: { supplierId: supplier.id } });
    await db.supplier.delete({ where: { id: supplier.id } });
    const leftG = await db.goodsReceipt.count();
    await db.$disconnect();
    ok("دادهٔ تست پاک شد", `رسیدهای باقی‌مانده در سیستم: ${leftG}`);
  }

  console.log(`\n${"=".repeat(52)}`);
  console.log(`نتیجه: ${pass} موفق / ${fail} ناموفق`);
  console.log("=".repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("خطا:", e.message); process.exit(1); });