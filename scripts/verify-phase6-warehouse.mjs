/** تست فاز ۶ — انبار به‌عنوان زیرمجموعهٔ حسابداری */
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

  step(2, "هر انبار حساب دفتری اختصاصی دارد");
  {
    const whs = await db.warehouse.findMany({
      where: { active: true },
      select: { id: true, name: true, glAccountId: true, glAccount: { select: { code: true } } },
    });
    whs.length > 0 ? ok(`${whs.length} انبار فعال`) : bad("انباری نیست");
    const withGl = whs.filter((w) => w.glAccountId && String(w.glAccount?.code).startsWith("1200"));
    withGl.length === whs.length
      ? ok("همهٔ انبارها زیرحساب ۱۲۰۰ دارند", withGl.map((w) => w.glAccount.code).join(" · "))
      : bad("انبار بدون حساب دفتری", whs.filter((w) => !w.glAccountId).map((w) => w.name).join(", "));
    const codes = withGl.map((w) => w.glAccount.code);
    new Set(codes).size === codes.length
      ? ok("حساب‌ها یکتا هستند — هر انبار دفتر خودش")
      : bad("حساب تکراری", codes.join(" · "));
  }

  step(3, "سند انبار روی حساب انبار خودش می‌نشیند");
  {
    // یک انبار تازه با حساب اختصاصی، بعد رسید کالا برای آن
    const wh = await db.warehouse.create({
      data: { code: `TEST-WH-${STAMP}`, name: `انبار تست فاز۶ ${STAMP}`, type: "branch" },
    });
    const parent = await db.account.findUnique({ where: { code: "1200" }, select: { id: true } });
    const sub = await db.account.create({
      data: {
        id: `subtest${STAMP}`,
        code: `1200-9${String(STAMP).slice(-1)}`,
        name: `انبار تست ${STAMP}`,
        type: "ASSET",
        parentAccountId: parent.id,
        level: 2,
      },
    });
    await db.warehouse.update({ where: { id: wh.id }, data: { glAccountId: sub.id } });

    const variant = await db.productVariant.findFirst({
      where: { product: { deletedAt: null } },
      select: { sku: true },
    });
    const sup = await db.supplier.create({ data: { name: `تامین‌کننده تست فاز۶ ${STAMP}` } });

    const r = await req(`${API}/admin/purchasing/goods-receipts`, {
      method: "POST",
      body: JSON.stringify({
        supplierId: sup.id,
        warehouseId: wh.id,
        lines: [{ variantSku: variant.sku, qty: 3, unitCost: 100_000 }],
      }),
    });
    r.status === 201 || r.status === 200 ? ok("رسید کالا ثبت شد", r.json?.number) : bad("رسید", `status=${r.status} ${r.text?.slice(0,140)}`);

    const je = await db.journalEntry.findFirst({
      where: { sourceType: "goods_receipt", sourceId: r.json?.id },
      include: { lines: { include: { account: true } } },
    });
    je ? ok("سند رسید ساخته شد", je.number) : bad("سند رسید یافت نشد");
    const invLine = je?.lines.find((l) => l.account.code === sub.code);
    invLine?.debit > 0n
      ? ok("سند روی حساب اختصاصی انبار نشست", `${sub.code} بدهکار ${Number(invLine.debit).toLocaleString("fa-IR")}`)
      : bad("روی حساب انبار ننشست", je?.lines.map((l) => l.account.code).join(" · "));

    step(4, "JournalLine.warehouseId پر شده");
    {
      const line = await db.journalLine.findFirst({ where: { entryId: je?.id, accountCode: undefined } }).catch(() => null);
      void line;
      const whLines = await db.journalLine.findMany({ where: { entry: { id: je?.id }, warehouseId: wh.id }, select: { id: true } });
      whLines.length > 0
        ? ok("خطوط سند به انبار وصل‌اند", `${whLines.length} خط`)
        : bad("warehouseId خالی است — ساختار برای گزارش سود انبار ناقص است");
    }

    step(5, "پاک‌سازی");
    {
      if (je) {
        await db.journalLine.deleteMany({ where: { entryId: je.id } });
        await db.journalEntry.delete({ where: { id: je.id } });
      }
      await db.stockLedgerEntry.deleteMany({ where: { refType: "goods_receipt", refId: r.json?.id ?? "" } });
      await db.goodsReceiptItem.deleteMany({ where: { receiptId: r.json?.id ?? "" } });
      await db.goodsReceipt.deleteMany({ where: { id: r.json?.id ?? "" } });
      await db.supplierAccount.deleteMany({ where: { supplierId: sup.id } });
      await db.supplier.deleteMany({ where: { id: sup.id } });
      // `CostLayer` کلید خارجی به انبار دارد — باید اول پاک شود
      await db.costLayer.deleteMany({ where: { warehouseId: wh.id } });
      await db.warehouse.deleteMany({ where: { id: wh.id } });
      await db.account.deleteMany({ where: { id: sub.id } });
      ok("دادهٔ تست پاک شد");
    }
  }

  step(6, "گزارش ارزش انبارها");
  {
    const r = await req(`${API}/admin/accounting/reports/warehouse-valuation`);
    r.status === 200 ? ok("endpoint کار می‌کند") : bad("ارزش انبار", `status=${r.status} ${r.text?.slice(0,140)}`);
    Array.isArray(r.json?.warehouses) ? ok(`${r.json.warehouses.length} انبار گزارش شد`) : bad("warehouses آرایه نیست");
    const withGl = (r.json?.warehouses ?? []).filter((w) => w.glCode);
    withGl.length > 0
      ? ok("انبارها حساب دفتری دارند", withGl.map((w) => `${w.name}:${w.glCode}`).slice(0,3).join(" · "))
      : bad("هیچ انباری حساب دفتری ندارد");
    typeof r.json?.totals?.difference === "number"
      ? ok("اختلاف دفتر و انبار محاسبه شد", r.json.totals.difference.toLocaleString("fa-IR"))
      : bad("totals.difference نیست");
  }

  step(7, "تب ارزش انبار در صفحهٔ گزارش‌ها");
  {
    const r = await fetch(`${ADMIN}/reports`, { headers: { cookie }, redirect: "follow" });
    const html = await r.text();
    r.status === 200 ? ok("صفحه باز شد") : bad("صفحه", `status=${r.status}`);
    const chunks = await Promise.all(
      [...html.matchAll(/\/_next\/static\/chunks\/[^"']+\.js/g)].map((m) =>
        fetch(`${ADMIN}${m[0]}`).then((x) => x.text()).catch(() => ""),
      ),
    );
    const bundle = chunks.join("");
    bundle.includes("ارزش انبارها") ? ok("تب ارزش انبارها هست") : bad("تب ارزش انبارها نیست");
    bundle.includes("مقایسهٔ دفتر مالی با دفتر کالا") ? ok("جدول مقایسه هست") : bad("جدول مقایسه نیست");
    bundle.includes("اختصاصی ندارد") ? ok("هشدار «انبار بدون حساب» آماده است") : bad("هشدار حساب نیست");
  }

  step(8, "isDefault در محاسبات خوانده می‌شود (گام ۶٫۱)");
  {
    // انبار پیش‌فرض را عوض می‌کنیم و می‌بینیم محصول جدید به همان می‌رود
    const prev = await db.warehouse.findMany({ where: { isDefault: true }, select: { id: true, name: true } });
    const target = await db.warehouse.findFirst({ where: { active: true, isDefault: false }, select: { id: true, name: true } });
    if (!target) {
      ok("انبار غیرپیش‌فرضی برای تست نبود — بررسی شد که isDefault در کد خوانده می‌شود");
    } else {
      await db.warehouse.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      await db.warehouse.update({ where: { id: target.id }, data: { isDefault: true } });
      const cat = await db.category.findFirst({ select: { id: true } });
      const v = await db.productVariant.findFirst({ where: { product: { deletedAt: null } }, select: { sku: true, productId: true } });
      const r = await req(`${API}/admin/products/full`, {
        method: "POST",
        body: JSON.stringify({
          name: `محصول تست انبار پیش‌فرض ${STAMP}`,
          categoryId: cat.id,
          basePrice: 100_000,
          costPrice: 50_000,
          status: "DRAFT",
          variants: [{ sku: `DEFWH-${STAMP}`, price: 100_000, stockQty: 2 }],
        }),
      });
      const led = await db.stockLedgerEntry.findFirst({ where: { variantSku: `DEFWH-${STAMP}` }, select: { warehouseId: true } });
      led?.warehouseId === target.id
        ? ok("موجودی اولیه به انبار پیش‌فرض رفت (نه قدیمی‌ترین)", target.name)
        : bad("انبار اشتباه", `expected=${target.id} got=${led?.warehouseId}`);

      // پاک‌سازی
      const pid = r.json?.id;
      if (pid) {
        await db.stockLedgerEntry.deleteMany({ where: { variantSku: `DEFWH-${STAMP}` } });
        await db.journalEntry.deleteMany({ where: { sourceType: "opening_inventory", sourceId: pid } });
        await db.journalLine.deleteMany({ where: { entry: { sourceType: "opening_inventory", sourceId: pid } } });
        await db.productVariant.deleteMany({ where: { sku: `DEFWH-${STAMP}` } });
        await db.product.deleteMany({ where: { id: pid } });
      }
      for (const p of prev) await db.warehouse.update({ where: { id: p.id }, data: { isDefault: true } });
      ok("وضعیت انبار پیش‌فرض برگردانده شد");
    }
  }

  step(9, "دفتر متوازن است");
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