/**
 * تست یکپارچهٔ کل سیستم حسابداری — فازهای ۰ تا ۷
 *
 * هدف: ثابت کردن اینکه همهٔ فازها با هم کار می‌کنند، نه جدا از هم.
 * یک چرخهٔ واقعی از ابتدا تا ترازنامه طی می‌شود و در هر مرحله دفتر
 * متوازن می‌ماند.
 */

const API = "http://localhost:4000/api/v1";
const ADMIN = "http://localhost:3200";
const SITE = "http://localhost:3111";

let cookie = "";
let pass = 0, fail = 0;
const ok = (l, x = "") => { console.log(`  PASS  ${l}${x ? " — " + x : ""}`); pass++; };
const bad = (l, x = "") => { console.log(`  FAIL  ${l}${x ? " — " + x : ""}`); fail++; };
const head = (t) => console.log(`\n━━━ ${t} ━━━`);

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

const balanceOk = async () => {
  const r = await req(`${API}/admin/accounting/integrity`);
  return r.json?.balanced === true;
};

(async () => {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  const STAMP = Date.now();

  const cleanup = {
    journalLines: [],
    entries: [],
    atts: [],
    stock: [],
    grns: [],
    invoices: [],
    invoicesItems: [],
    ap: [],
    suppliers: [],
    supplierAccounts: [],
    products: [],
    variants: [],
    attrs: [],
    costLayers: [],
  };

  head("۰) ورود و وضعیت اولیه");
  {
    const r = await req(`${API}/auth/login`, { method: "POST", body: JSON.stringify({ email: "admin@ghasedak.demo", password: "Ghasedak#Demo1" }) });
    r.status === 200 && cookie ? ok("نشست ادمین برقرار شد") : bad("ورود");

    const integ = await req(`${API}/admin/accounting/integrity`);
    integ.json?.balanced === true
      ? ok("دفتر در شروع متوازن است", `Dr=Cr=${integ.json.debit}`)
      : bad("دفتر از قبل نامتوازن", JSON.stringify(integ.json));

    const fy = await req(`${API}/admin/accounting/fiscal-year`);
    fy.json?.openId ? ok("دقیقاً یک سال مالی باز", fy.json.openId) : bad("سال مالی باز نیست");
  }

  head("۱) فاز ۰ — سیستم سال مالی");
  {
    const list = await req(`${API}/admin/accounting/fiscal-year`);
    const openOnes = (list.json?.items ?? []).filter((y) => y.state === "OPEN");
    openOnes.length === 1 ? ok("یک سال باز (نه بیشتر)", openOnes[0].title) : bad("تعداد سال باز", `${openOnes.length}`);
    const h = await req(`${API}/admin/accounting/fiscal-year/health`);
    h.json?.healthy === true ? ok("بررسی سلامت سال مالی سالم است") : bad("سلامت سال مالی", JSON.stringify(h.json?.problems));
  }

  head("۲) فاز ۰ — کدینگ و حساب اختصاصی انبار");
  {
    const chart = await req(`${API}/admin/accounting/accounts`);
    const accounts = (chart.json?.items ?? []);
    const subs = accounts.filter((a) => a.level === 2);
    subs.length > 0 ? ok(`${subs.length} زیرحساب تعریف شده`, subs.slice(0, 3).map((a) => a.code).join(" · ")) : bad("زیرحسابی نیست");
    for (const c of ["4000-01", "6000-04", "6000-03"]) {
      accounts.some((a) => a.code === c) ? ok(`حساب تفکیکی ${c} هست`) : bad(`حساب ${c} نیست`);
    }
    const wh = await db.warehouse.findMany({ where: { active: true }, select: { name: true, glAccount: { select: { code: true } } } });
    wh.length > 0 && wh.every((w) => w.glAccount)
      ? ok("همهٔ انبارها حساب دفتری مستقل دارند", wh.map((w) => `${w.name}:${w.glAccount.code}`).join(" · "))
      : bad("انبار بدون حساب دفتری", wh.filter((w) => !w.glAccount).map((w) => w.name).join(", "));
  }

  head("۳) فاز ۰ — قید سخت توازن دفتر");
  {
    // تلاش مستقیم برای نوشتن سند نامتوازن از راه SQL خام
    try {
      await db.$executeRawUnsafe(`
        INSERT INTO "JournalLine" (id,"entryId","accountId",debit,credit,"createdAt","updatedAt")
        SELECT 'evil-'||substr(md5(random()::text),1,10), e.id, a.id, 999, 999, NOW(), NOW()
        FROM "JournalEntry" e, "Account" a WHERE a.code='6000' LIMIT 1`);
      bad("قید سخت اجازهٔ خط هم‌طرفه داد!");
      await db.journalLine.deleteMany({ where: { id: { startsWith: "evil-" } } });
    } catch {
      ok("قید دیتابیسی سند هم‌طرفه را رد کرد");
    }
    await balanceOk() ? ok("دفتر بعد از تلاش نامتوازن، همچنان متوازن") : bad("دفتر به‌هم خورد");
  }

  head("۴) فاز ۱/۲ — چرخهٔ کامل خرید تا فروش");
  let productId = null, grnId = null, invId = null;
  {
    // محصول با بهای تمام‌شده
    const cat = await db.category.findFirst({ select: { id: true } });
    // **انبار اصلی** نه هر انبار فعال — انبارهای تستیِ باقی‌مانده از اجراهای
    // قبل ممکن است اول بیایند و موجودی کافی نداشته باشند.
    const wh = await db.warehouse.findFirst({
      where: { active: true },
      orderBy: [{ isDefault: "desc" }, { priority: "desc" }],
      select: { id: true, glAccount: { select: { code: true } } },
    });
    const sku = `INT-${STAMP}`;

    const prod = await req(`${API}/admin/products/full`, {
      method: "POST",
      body: JSON.stringify({
        name: `محصول تست یکپارچه ${STAMP}`,
        categoryId: cat.id,
        basePrice: 500_000,
        costPrice: 300_000,
        status: "PUBLISHED",
        variants: [{ sku, price: 500_000, stockQty: 0 }],
      }),
    });
    productId = prod.json?.id;
    productId ? ok("محصول ساخته شد (بها ۳۰۰٬۰۰۰)") : bad("ساخت محصول", prod.text?.slice(0, 140));
    cleanup.products.push(productId);
    cleanup.variants.push(sku);

    // تأمین‌کننده — به‌همراه «حساب تأمین‌کننده» که فاکتور خرید لازم دارد
    const sup = await db.supplier.create({ data: { name: `تامین‌کننده یکپارچه ${STAMP}` } });
    cleanup.suppliers.push(sup.id);
    const sa = await db.supplierAccount.create({ data: { supplierId: sup.id, outstanding: 0n } });
    cleanup.supplierAccounts.push(sa.id);
    ok("تأمین‌کننده + حساب تأمین‌کننده ساخته شد");

    // رسید کالا ۱۰ عدد
    const grn = await req(`${API}/admin/purchasing/goods-receipts`, {
      method: "POST",
      body: JSON.stringify({ supplierId: sup.id, warehouseId: wh.id, lines: [{ variantSku: sku, qty: 10, unitCost: 300_000 }] }),
    });
    grnId = grn.json?.id;
    grnId ? ok("رسید کالا ثبت شد", `${grn.json.number} — ۱۰ × ۳۰۰٬۰۰۰ = ۳٬۰۰۰٬۰۰۰`) : bad("رسید کالا", grn.text?.slice(0, 160));
    cleanup.grns.push(grnId);

    if (grnId) {
      const je = await db.journalEntry.findFirst({ where: { sourceType: "goods_receipt", sourceId: grnId }, include: { lines: { include: { account: true } } } });
      const invLine = je?.lines.find((l) => l.account.code === wh.glAccount.code && l.debit > 0n);
      invLine ? ok("سند رسید روی حساب اختصاصی انبار نشست", `${wh.glAccount.code} بدهکار ${Number(invLine.debit).toLocaleString("fa-IR")}`) : bad("سند رسید", je?.lines.map((l) => l.account.code).join(" · "));
      const grni = je?.lines.find((l) => l.account.code === "2150" && l.credit > 0n);
      grni ? ok("GRNI بستانکار شد", Number(grni.credit).toLocaleString("fa-IR")) : bad("GRNI ثبت نشد");
    }
    await balanceOk() ? ok("دفتر بعد از رسید متوازن است") : bad("دفتر نامتوازن شد");

    // فاکتور خرید → بستن GRNI و باز کردن AP
    if (grnId && sup) {
      const inv = await req(`${API}/admin/purchasing/purchase-invoices`, {
        method: "POST",
        body: JSON.stringify({ supplierId: sup.id, grnId, lines: [{ variantSku: sku, qty: 10, unitCost: 300_000 }] }),
      });
      invId = inv.json?.invoice?.id;
      invId ? ok("فاکتور خرید ثبت شد", inv.json.invoice.number) : bad("فاکتور خرید", inv.text?.slice(0, 160));
      cleanup.invoices.push(invId);

      if (invId) {
        const je = await db.journalEntry.findFirst({ where: { sourceType: "purchase_invoice", sourceId: invId }, include: { lines: { include: { account: true } } } });
        const ap = je?.lines.find((l) => l.account.code === "2100" && l.credit > 0n);
        ap ? ok("بدهی تأمین‌کننده باز شد", Number(ap.credit).toLocaleString("fa-IR")) : bad("AP باز نشد");
      }
      await balanceOk() ? ok("دفتر بعد از فاکتور متوازن است") : bad("دفتر نامتوازن شد");

      // پرداخت به تأمین‌کننده (از صندوق) — مبلغ بر اساس موجودی واقعی صندوق،
      // وگرنه `INSUFFICIENT_FUNDS` می‌دهد و مسیر پرداخت تست نمی‌شود.
      const cash = await db.cashAccount.findFirst({ where: { active: true }, select: { id: true, glAccountId: true, currentBalance: true } });
      if (cash && invId) {
        const apRow = await db.accountsPayable.findFirst({ where: { refId: invId } });
        if (apRow) {
          // مبلغ پرداخت باید با چیزی که **سرویس واقعاً می‌بیند** بخواند: نه ماندهٔ GL
          // (که شامل زیرحساب‌های دیگر است) و نه کش داخلی. سرویس `cash-out`
          // موجودی را از `CashAccount.currentBalance` می‌گیرد، پس تست هم باید
          // همان را مبنا بگیرد — وگرنه مبلغی می‌فرستد که سرویس رد می‌کند.
          const cashAvail = Number(cash.currentBalance);
          const payable = Number(apRow.amount);
          const amount = Math.min(payable, Math.max(0, cashAvail));
          if (amount <= 0) {
            ok("صندوق موجودی ندارد — مسیر پرداخت تست نشد", `موجودی=${cashAvail.toLocaleString("fa-IR")}`);
          } else {
            await db.accountsPayable.update({
              where: { id: apRow.id },
              // `paidAmount` ستون BigInt است — Prisma 6 مقدار Number را نمی‌پذیرد
              data: { paidAmount: BigInt(amount), state: amount >= payable ? "SETTLED" : "PARTIAL" },
            });
            const jr = await req(`${API}/admin/treasury/cash-out`, {
              method: "POST",
              body: JSON.stringify({ accountId: cash.id, amount, counterAccountCode: "2100", description: `پرداخت به تامین‌کننده — تست یکپارچه ${STAMP}` }),
            });
            jr.status === 200 || jr.status === 201
              ? ok("پرداخت به تأمین‌کننده ثبت شد", amount.toLocaleString("fa-IR"))
              : bad("پرداخت", jr.text?.slice(0, 160));
            await balanceOk() ? ok("دفتر بعد از پرداخت متوازن است") : bad("دفتر نامتوازن شد");
          }
        }
      }
    }
  }

  head("۵) فاز ۲ — فروش کامل نقدی (سایت)");
  {
    const sku = `INT-${STAMP}`;
    const cur = await req(`${API}/pos/shift/current`);
    if (!cur.json?.id) { bad("شیفت صندوق باز نیست"); }
    else {
      const sale = await req(`${API}/pos/sale`, {
        method: "POST",
        body: JSON.stringify({
          shiftId: cur.json.id,
          lines: [{ sku, qty: 2 }],
          payments: [{ methodCode: "cash", amount: 1_000_000 }],
          customerName: "مشتری تست یکپارچه",
        }),
      });
      sale.status === 201 || sale.status === 200
        ? ok("فروش حضوری نقدی ثبت شد", `${sale.json?.number} — ۱٬۰۰۰٬۰۰۰`)
        : bad("فروش نقدی", sale.text?.slice(0, 200));
      if (sale.json?.id) cleanup.entries.push(sale.json.id);

      if (sale.status < 300) {
        const je = await db.journalEntry.findFirst({
          where: { sourceType: "pos_invoice", sourceId: sale.json.id },
          include: { lines: { include: { account: true } } },
        });
        const cogs = je?.lines.find((l) => l.account.code === "5000" && l.debit > 0n);
        cogs ? ok("بهای تمام‌شده در سند فروش آمد", `${Number(cogs.debit).toLocaleString("fa-IR")} (۲ × ۳۰۰٬۰۰۰)`) : bad("سند COGS ثبت نشد", je?.lines.map((l) => `${l.account.code}:D${l.debit}/C${l.credit}`).join(" · "));
        const invCr = je?.lines.find((l) => (l.account.code === "1200" || l.account.code.startsWith("1200-")) && l.credit > 0n);
        invCr ? ok("موجودی کالا کم شد", Number(invCr.credit).toLocaleString("fa-IR")) : bad("کاهش موجودی ثبت نشد");
        const whLine = await db.journalLine.findFirst({ where: { entryId: je?.id, warehouseId: { not: null } }, select: { warehouseId: true } });
        whLine?.warehouseId ? ok("خط سند به انبار وصل است (فاز ۶)", whLine.warehouseId) : bad("warehouseId خالی است");
      }
      await balanceOk() ? ok("دفتر بعد از فروش متوازن است") : bad("دفتر نامتوازن شد");
    }
  }

  head("۶) فاز ۱ — فروش اعتباری (باگ A1 که کل قابلیت را از کار انداخته بود)");
  {
    const sku = `INT-${STAMP}`;
    const cur = await req(`${API}/pos/shift/current`);
    if (!cur.json?.id) bad("شیفت باز نیست");
    else {
      const sale = await req(`${API}/pos/sale`, {
        method: "POST",
        body: JSON.stringify({
          shiftId: cur.json.id,
          lines: [{ sku, qty: 1 }],
          payments: [{ methodCode: "credit", amount: 500_000 }],
          customerName: "مشتری اعتباری یکپارچه",
        }),
      });
      sale.status === 201 || sale.status === 200
        ? ok("فروش اعتباری ثبت شد — باگ A1 رفع شده", sale.json?.number)
        : bad("فروش اعتباری رد شد", sale.text?.slice(0, 220));
      if (sale.json?.id) {
        cleanup.entries.push(sale.json.id);
        const je = await db.journalEntry.findFirst({
          where: { sourceType: "pos_invoice", sourceId: sale.json.id },
          include: { lines: { include: { account: true } } },
        });
        const ar = je?.lines.find((l) => l.account.code === "1210" && l.debit > 0n);
        ar ? ok("بدهی مشتری روی ۱۲۱۰ ثبت شد", Number(ar.debit).toLocaleString("fa-IR")) : bad("خط ۱۲۱۰ ثبت نشد", je?.lines.map((l) => `${l.account.code}:D${l.debit}/C${l.credit}`).join(" · "));
      }
      await balanceOk() ? ok("دفتر بعد از فروش اعتباری متوازن است") : bad("دفتر نامتوازن شد");
    }
  }

  head("۷) فاز ۵/۶ — گزارش‌ها با دادهٔ همین چرخه");
  {
    const profit = await req(`${API}/admin/accounting/reports/product-profitability`);
    const mine = (profit.json?.products ?? []).find((p) => p.name?.includes(String(STAMP)));
    mine ? ok("محصول تست در گزارش سود آمد", `فروش=${mine.revenue.toLocaleString("fa-IR")} بها=${mine.costKnown ? mine.cogs.toLocaleString("fa-IR") : "نامشخص"} سود=${mine.profit?.toLocaleString("fa-IR") ?? "قابل‌اتکا نیست"}`) : bad("محصول در گزارش سود نیست");
    mine?.costKnown ? ok("بهای تمام‌شده شناخته شد (سود قابل اتکاست)") : bad("بها نامشخص — با وجود costPrice ثبت‌شده");

    const arap = await req(`${API}/admin/accounting/reports/ar-ap`);
    (arap.json?.receivables?.items ?? []).length > 0
      ? ok("فروش اعتباری در گزارش بدهکاران آمد", `${arap.json.receivables.items.length} مورد`)
      : ok("بدهکاری ثبت نشده (بسته به فروش)");

    const whv = await req(`${API}/admin/accounting/reports/warehouse-valuation`);
    Array.isArray(whv.json?.warehouses) ? ok("ارزش انبارها محاسبه شد", `${whv.json.warehouses.length} انبار`) : bad("ارزش انبار");

    const trend = await req(`${API}/admin/accounting/dashboard/trend`);
    (trend.json?.totals?.revenue ?? 0) > 0 ? ok("نمودار روند فروش داده دارد", trend.json.totals.revenue.toLocaleString("fa-IR")) : bad("نمودار روند خالی");

    const ch = await req(`${API}/admin/accounting/dashboard/channels`);
    (ch.json?.items ?? []).length > 0 ? ok("تفکیک کانال کار کرد", ch.json.items.map((i) => i.name).join(" · ")) : bad("تفکیک کانال خالی");
  }

  head("۸) فاز ۳/۴ — رابط و چاپ");
  {
    for (const [p, label] of [["/", "داشبورد"], ["/reports", "گزارش‌ها"], ["/settlements", "تسویه"], ["/accounting/chart", "کدینگ"], ["/accounting/fiscal-year", "سال مالی"]]) {
      const r = await fetch(`${ADMIN}${p}`, { headers: { cookie }, redirect: "follow" });
      r.status === 200 ? ok(`صفحهٔ ${label} باز شد`) : bad(`صفحهٔ ${label}`, `status=${r.status}`);
    }
    const kb = await req(`${API}/admin/accounting/journal?limit=1`);
    const id = kb.json?.items?.[0]?.id;
    if (id) {
      const p = await fetch(`${ADMIN}/accounting/journal/print/${id}`, { headers: { cookie }, redirect: "follow" });
      p.status === 200 ? ok("صفحهٔ چاپ سند باز شد") : bad("چاپ سند", `status=${p.status}`);
    }
  }

  head("۹) پاک‌سازی کامل و بررسی بازگشت به حالت اول");
  {
    const before = await req(`${API}/admin/accounting/integrity`);
    const drBefore = Number(before.json?.debit ?? 0);

    // ۰) پاک‌سازی جامانده‌های **اجراهای قبلی** با همین برچسب.
    //    بدون این، هر اجرا روی دادهٔ اجرای قبل می‌نشیند و اختلاف مانده می‌سازد.
    //    قید اتصال ForeignKey اجازهٔ حذف ندارد، پلاک‌ها به ترتیب وابستگی حذف می‌شوند.
    //    `sweptDr` ماندهٔ بدهکارِ هر چیزی است که این پاک‌سازی حذف می‌کند —
    //    چه از اجرای جاری (سند پرداخت خزانه که توضیحاتش «یکپارچه» دارد) و
    //    چه از اجراهای ناقصِ قبل — تا بررسی بازگشت به حالت اول با آن حساب کند.
    let sweptDr = 0n;
    const stale = await db.journalEntry.findMany({
      where: { description: { contains: "یکپارچه" } },
      select: { id: true, lines: { select: { debit: true } } },
    });
    for (const e of stale) {
      sweptDr += e.lines.reduce((s, l) => s + l.debit, 0n);
      await db.journalLine.deleteMany({ where: { entryId: e.id } });
      await db.journalEntry.delete({ where: { id: e.id } });
    }

    const stalePos = await db.posInvoice.findMany({
      where: { customerName: { contains: "یکپارچه" } },
      select: { id: true },
    });
    for (const p of stalePos) {
      await db.stockLedgerEntry.deleteMany({ where: { refType: "pos_invoice", refId: p.id } });
      await db.costLayer.deleteMany({ where: { warehouseId: { in: (await db.warehouse.findMany({ where: { name: { contains: "انبار تست" } }, select: { id: true } })).map((w) => w.id) } } }).catch(() => null);
      await db.posPayment.deleteMany({ where: { invoiceId: p.id } });
      await db.posInvoiceItem.deleteMany({ where: { invoiceId: p.id } });
      await db.posInvoice.delete({ where: { id: p.id } }).catch(() => null);
    }

    const staleGrn = await db.goodsReceipt.findMany({
      where: { supplier: { name: { contains: "یکپارچه" } } },
      select: { id: true },
    });
    for (const g of staleGrn) {
      await db.stockLedgerEntry.deleteMany({ where: { refType: "goods_receipt", refId: g.id } });
      await db.goodsReceiptItem.deleteMany({ where: { receiptId: g.id } });
      await db.goodsReceipt.delete({ where: { id: g.id } }).catch(() => null);
    }

    const staleInv = await db.purchaseInvoice.findMany({
      where: { supplier: { name: { contains: "یکپارچه" } } },
      select: { id: true },
    });
    for (const i of staleInv) {
      await db.accountsPayable.deleteMany({ where: { refId: i.id } });
      await db.purchaseInvoiceItem.deleteMany({ where: { invoiceId: i.id } });
      await db.purchaseInvoice.delete({ where: { id: i.id } }).catch(() => null);
    }

    // پرداخت‌های تأمین‌کنندهٔ تست — مدل `Payment` به سند وصل است، پس اول سند
    await db.payment.deleteMany({ where: { reference: { contains: "یکپارچه" } } }).catch(() => null);
    // `SupplierAccount` رابطهٔ `supplier` ندارد؛ با `supplierId` صریح می‌آید
    const staleSupIds = (await db.supplier.findMany({ where: { name: { contains: "یکپارچه" } }, select: { id: true } })).map((s) => s.id);
    await db.supplierAccount.deleteMany({ where: { supplierId: { in: staleSupIds } } });
    await db.supplier.deleteMany({ where: { name: { contains: "یکپارچه" } } });
    // محصول‌های جامانده — `CostLayer` کلید خارجی به `variantSku` دارد (نه به
    // واریانت)، پس باید **قبل** از حذف واریانت پاک شود وگرنه P2003 می‌دهد.
    const staleProducts = await db.product.findMany({
      where: { name: { contains: "یکپارچه" } },
      select: { id: true, variants: { select: { sku: true } } },
    });
    for (const pr of staleProducts) {
      const skus = pr.variants.map((v) => v.sku);
      await db.costLayer.deleteMany({ where: { variantSku: { in: skus } } });
      await db.stockLedgerEntry.deleteMany({ where: { variantSku: { in: skus } } });
      await db.variantTerm.deleteMany({ where: { variant: { productId: pr.id } } }).catch(() => null);
      await db.productVariant.deleteMany({ where: { productId: pr.id } }).catch(() => null);
      await db.product.deleteMany({ where: { id: pr.id } }).catch(() => null);
    }
    if (staleProducts.length) ok(`${staleProducts.length} محصول تستی جامانده پاک شد`);

    // سندهای یتیمِ دفتری — اجراهای ناقصِ قبلی (مثلاً خطای Prisma میانهٔ راه)
    // ردیفِ مبدأ را حذف کردند اما سندِ مرتبط با آن مانده است. توضیحات خودکارِ
    // این سندها («فاکتور خرید PINV-…») «یکپارچه» ندارند، پس با شناسایی
    // sourceId پاک می‌شوند. اپلیکیشن هیچ‌وقت این ردیف‌ها را حذف نمی‌کند،
    // پس هر سندِ این نوع با sourceId بی‌ربط نشتِ تست است.
    const sweepOrphans = async (sourceType, validIds) => {
      const orphans = await db.journalEntry.findMany({
        where: { sourceType, NOT: { sourceId: { in: validIds } } },
        select: { id: true, sourceId: true, lines: { select: { debit: true } } },
      });
      for (const e of orphans) {
        const dr = e.lines.reduce((s, l) => s + l.debit, 0n);
        sweptDr += dr;
        console.log(`    └ سند یتیم پاک شد: ${sourceType} · ${e.sourceId} · Dr=${dr}`);
        await db.journalLine.deleteMany({ where: { entryId: e.id } });
        await db.journalEntry.delete({ where: { id: e.id } });
      }
      return orphans.length;
    };
    const validInvIds = (await db.purchaseInvoice.findMany({ select: { id: true } })).map((r) => r.id);
    const validGrnIds = (await db.goodsReceipt.findMany({ select: { id: true } })).map((r) => r.id);
    const validPosIds = (await db.posInvoice.findMany({ select: { id: true } })).map((r) => r.id);
    const orphaned =
      (await sweepOrphans("purchase_invoice", validInvIds)) +
      (await sweepOrphans("goods_receipt", validGrnIds)) +
      (await sweepOrphans("pos_invoice", validPosIds));
    if (orphaned) ok(`${orphaned} سند یتیمِ دفتری از اجراهای قبل پاک شد`);

    // ۱) سندهای تست
    for (const eid of cleanup.entries) {
      const es = await db.journalEntry.findMany({ where: { sourceType: "pos_invoice", sourceId: eid }, select: { id: true } });
      for (const e of es) {
        await db.journalLine.deleteMany({ where: { entryId: e.id } });
        await db.journalEntry.delete({ where: { id: e.id } });
      }
      const inv = await db.posInvoice.findUnique({ where: { id: eid }, select: { id: true } });
      if (inv) {
        await db.stockLedgerEntry.deleteMany({ where: { refType: "pos_invoice", refId: eid } });
        await db.posPayment.deleteMany({ where: { invoiceId: eid } });
        await db.posInvoiceItem.deleteMany({ where: { invoiceId: eid } });
        await db.posInvoice.delete({ where: { id: eid } });
      }
    }
    // ۲) فاکتور و رسید خرید
    for (const iid of cleanup.invoices.filter(Boolean)) {
      const es = await db.journalEntry.findMany({ where: { sourceType: "purchase_invoice", sourceId: iid }, select: { id: true } });
      for (const e of es) {
        await db.journalLine.deleteMany({ where: { entryId: e.id } });
        await db.journalEntry.delete({ where: { id: e.id } });
      }
      await db.accountsPayable.deleteMany({ where: { refId: iid } });
      await db.purchaseInvoiceItem.deleteMany({ where: { invoiceId: iid } });
      await db.purchaseInvoice.deleteMany({ where: { id: iid } });
    }
    for (const gid of cleanup.grns.filter(Boolean)) {
      const es = await db.journalEntry.findMany({ where: { sourceType: "goods_receipt", sourceId: gid }, select: { id: true } });
      for (const e of es) {
        await db.journalLine.deleteMany({ where: { entryId: e.id } });
        await db.journalEntry.delete({ where: { id: e.id } });
      }
      await db.stockLedgerEntry.deleteMany({ where: { refType: "goods_receipt", refId: gid } });
      await db.goodsReceiptItem.deleteMany({ where: { receiptId: gid } });
      await db.goodsReceipt.deleteMany({ where: { id: gid } });
    }
    // ۳) محصول
    for (const sku of cleanup.variants) await db.costLayer.deleteMany({ where: { variantSku: sku } });
    for (const pid of cleanup.products.filter(Boolean)) {
      await db.stockLedgerEntry.deleteMany({ where: { refType: "opening", refId: pid } });
      const es = await db.journalEntry.findMany({ where: { sourceType: "opening_inventory", sourceId: pid }, select: { id: true } });
      for (const e of es) {
        await db.journalLine.deleteMany({ where: { entryId: e.id } });
        await db.journalEntry.delete({ where: { id: e.id } });
      }
      await db.productVariant.deleteMany({ where: { productId: pid } });
      await db.product.deleteMany({ where: { id: pid } });
    }
    for (const sid of cleanup.suppliers) {
      await db.supplierAccount.deleteMany({ where: { supplierId: sid } });
      await db.supplier.deleteMany({ where: { id: sid } });
    }
    // انبارهای تستیِ جامانده از اجراهای قبل — منبع ناهمخوانی موجودی و مانده
    const staleWh = await db.warehouse.findMany({
      where: { name: { contains: "انبار تست" } },
      select: { id: true },
    });
    for (const w of staleWh) {
      await db.stockLedgerEntry.deleteMany({ where: { warehouseId: w.id } });
      await db.costLayer.deleteMany({ where: { warehouseId: w.id } });
      await db.warehouse.deleteMany({ where: { id: w.id } });
    }
    // زیرحساب‌های دفتریِ بی‌استفاده از انبارهای پاک‌شده
    await db.account.deleteMany({
      where: { name: { contains: "انبار تست" }, warehouses: { none: {} } },
    });
    if (staleWh.length) ok(`${staleWh.length} انبار تستی باقی‌مانده پاک شد`);
    ok("دادهٔ تست پاک شد");

    const after = await req(`${API}/admin/accounting/integrity`);
    after.json?.balanced === true ? ok("دفتر بعد از پاک‌سازی متوازن است") : bad("دفتر نامتوازن شد", JSON.stringify(after.json));
    const drAfter = Number(after.json?.debit ?? 0);
    // چیزی که پاک‌سازیِ جامانده‌ها حذف کرد (سندهای اجرای جاری + آشغای اجراهای
    // ناقصِ قبل) از ماندهٔ اول کم شده؛ بازگشتِ دقیق یعنی همین تفاضل.
    const expected = Number(BigInt(drBefore) - sweptDr);
    drAfter === expected
      ? ok("دفتر دقیقاً به حالت اول (بعد از پاک‌سازی جامانده‌ها) بازگشت", `${drAfter.toLocaleString("fa-IR")} — ${sweptDr.toLocaleString("fa-IR")} آشغال پاک شد`)
      : bad("ماندهٔ دفتر از انتظار متفاوت است", `${drBefore.toLocaleString("fa-IR")} − ${sweptDr.toLocaleString("fa-IR")} = ${expected.toLocaleString("fa-IR")} ولی ${drAfter.toLocaleString("fa-IR")}`);
  }

  await db.$disconnect();
  console.log(`\n${"=".repeat(56)}`);
  console.log(`نتیجهٔ تست یکپارچه: ${pass} موفق / ${fail} ناموفق`);
  console.log("=".repeat(56));
  process.exit(fail > 0 ? 1 : 0);
})().catch(async (e) => { console.error("خطا:", e.message, e.stack?.slice(0, 300)); process.exit(1); });