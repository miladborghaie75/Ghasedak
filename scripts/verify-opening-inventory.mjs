const API = "http://localhost:4000/api/v1";
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

  const balOf = async () => {
    const r = await db.$queryRawUnsafe(
      `SELECT COALESCE(SUM(l.debit - l.credit),0) AS n FROM "JournalLine" l JOIN "Account" a ON a.id=l."accountId" WHERE a.code='1200'`,
    );
    return Number(r[0].n);
  };

  const createProduct = (costPrice) =>
    req(`${API}/admin/products/full`, {
      method: "POST",
      body: JSON.stringify({
        name: `محصول تست سند اولیه ${STAMP} ${costPrice ?? "بدون بها"}`,
        categoryId: catId,
        basePrice: 500000,
        costPrice,
        status: "DRAFT",
        variants: [{ sku: `OPEN-TEST-${STAMP}-${costPrice ?? "N"}`, price: 500000, stockQty: 10 }],
      }),
    });

  step(1, "ورود ادمین");
  await req(`${API}/auth/login`, { method: "POST", body: JSON.stringify({ email: "admin@ghasedak.demo", password: "Ghasedak#Demo1" }) });
  const cat = await db.category.findFirst({ select: { id: true } });
  if (!cat) { bad("دسته‌ای نیست"); await db.$disconnect(); process.exit(1); }
  const catId = cat.id;

  step(2, "محصول با بهای خرید → باید سند موجودی بزند");
  let productId = null;
  let balBefore = 0;
  {
    balBefore = await balOf();
    const r = await createProduct(200000);
    productId = r.json?.id ?? null;
    r.json?.openingJournalPosted === true
      ? ok("پاسخ می‌گوید سند ثبت شد")
      : bad("سند ثبت نشد", `status=${r.status} ${r.text?.slice(0, 140)}`);
    const after = await balOf();
    const expected = 10 * 200000;
    after - balBefore === expected
      ? ok("ماندهٔ ۱۲۰۰ به اندازهٔ ارزش موجودی بالا رفت", `+${(after - balBefore).toLocaleString("fa-IR")}`)
      : bad("ماندهٔ ۱۲۰۰", `Δ=${after - balBefore} ≠ ${expected}`);
  }

  step(3, "سند باید Dr 1200 / Cr 3900 باشد");
  {
    const je = await db.journalEntry.findFirst({
      where: { sourceType: "opening_inventory", sourceId: productId },
      include: { lines: { include: { account: true } } },
    });
    je ? ok("سند موجودی آغازین هست", je.number) : bad("سند یافت نشد");
    if (je) {
      const dr = je.lines.filter((l) => l.account.code === "1200").reduce((s, l) => s + Number(l.debit), 0);
      const cr = je.lines.filter((l) => l.account.code === "3900").reduce((s, l) => s + Number(l.credit), 0);
      const td = je.lines.reduce((s, l) => s + Number(l.debit), 0);
      const tc = je.lines.reduce((s, l) => s + Number(l.credit), 0);
      dr > 0 && dr === cr
        ? ok("سند متوازن و به سرمایه بسته شد", `Dr=${dr.toLocaleString("fa-IR")}`)
        : bad("سند نادرست", `Dr1200=${dr} Cr3900=${cr}`);
      td === tc ? ok("جمع بدهکار = بستانکار") : bad("نامتوازن", `Dr=${td} Cr=${tc}`);
    }
  }

  step(4, "محصول بدون بهای خرید → سند جعلی نزند، هشدار بدهد");
  {
    const r = await createProduct(null);
    r.json?.id ? ok("محصول ساخته شد") : bad("ساخت", `status=${r.status}`);
    const je = await db.journalEntry.findFirst({ where: { sourceType: "opening_inventory", sourceId: r.json?.id } });
    je === null ? ok("سند جعلی زده نشد — درست") : bad("سند با مبلغ ساختگی زده شد", je.number);
    r.json?.openingWarning ? ok("هشدار صادقانه داده شد", String(r.json.openingWarning).slice(0, 60) + "…") : bad("هشدار نداد");
    await db.stockLedgerEntry.deleteMany({ where: { variantSku: { endsWith: "-N" } } }).catch(() => null);
    await db.productVariant.deleteMany({ where: { sku: { endsWith: `-${STAMP}-N` } } }).catch(() => null);
    await db.product.delete({ where: { id: r.json?.id } }).catch(() => null);
  }

  step(5, "افزایش موجودی در ویرایش هم باید سند بزند");
  {
    const detail = await req(`${API}/admin/products/${productId}/detail`);
    const v = detail.json?.variants?.[0];
    if (!v) bad("واریانت پیدا نشد");
    else {
      const before = await balOf();
      const r = await req(`${API}/admin/products/${productId}/full`, {
        method: "PUT",
        body: JSON.stringify({
          name: detail.json.name,
          categoryId: detail.json.categoryId,
          basePrice: 500000,
          costPrice: 200000,
          variants: [{ id: v.id, sku: v.sku, price: 500000, stockQty: (v.stockQty ?? 10) + 5 }],
        }),
      });
      r.json?.openingJournalPosted === true
        ? ok("سند افزایش موجودی ثبت شد")
        : bad("سند ثبت نشد", `status=${r.status} ${r.text?.slice(0, 120)}`);
      const after = await balOf();
      const expected = 5 * 200000;
      after - before === expected
        ? ok("ارزش افزایش در دفتر نشست", `+${(after - before).toLocaleString("fa-IR")}`)
        : bad("مانده", `Δ=${after - before} ≠ ${expected}`);
    }
  }

  step(6, "پاک‌سازی کامل");
  {
    const entries = await db.journalEntry.findMany({
      where: { sourceType: "opening_inventory", sourceId: productId },
      select: { id: true },
    });
    for (const e of entries) {
      await db.journalLine.deleteMany({ where: { entryId: e.id } });
      await db.journalEntry.delete({ where: { id: e.id } });
    }
    await db.stockLedgerEntry.deleteMany({ where: { variantSku: { contains: String(STAMP) } } });
    await db.productVariant.deleteMany({ where: { sku: { contains: String(STAMP) } } });
    await db.product.delete({ where: { id: productId } }).catch(() => null);
    const after = await balOf();
    const expectAfter = balBefore;
    after === expectAfter
      ? ok("دفتر دقیقاً به حالت اول برگشت", after.toLocaleString("fa-IR"))
      : bad("دفتر برنگشت", `${balBefore} → ${after}`);
  }

  step(7, "دفتر سالم است");
  {
    const integ = await req(`${API}/admin/accounting/integrity`);
    integ.json?.balanced === true
      ? ok("دفتر متوازن", `Dr=${Number(integ.json.debit).toLocaleString("fa-IR")}`)
      : bad("نامتوازن", JSON.stringify(integ.json));
  }

  await db.$disconnect();
  console.log(`\n${"=".repeat(52)}`);
  console.log(`نتیجه: ${pass} موفق / ${fail} ناموفق`);
  console.log("=".repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("خطا:", e.message); process.exit(1); });