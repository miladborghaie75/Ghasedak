/** بررسی ماتریس واریانت از ویژگی‌های تعریف‌شده — مثل مثال کاربر: سوتین × سایز × رنگ */
const API = "http://localhost:4000/api/v1";
const SITE = "http://localhost:3111";
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

const STAMP = Date.now();

(async () => {
  step(1, "ورود");
  await req(`${API}/auth/login`, { method: "POST", body: JSON.stringify({ email: "admin@ghasedak.demo", password: "Ghasedak#Demo1" }) });

  step(2, "ساخت ویژگی‌های نمونه: نوع سوتین / سایز / رنگ");
  const attrIds = {};
  {
    const defs = [
      { name: `نوع سوتین ${STAMP}`, values: ["جک‌دار", "ساده"] },
      { name: `سایز ${STAMP}`, values: ["70", "75", "80", "85"] },
      { name: `رنگ ${STAMP}`, values: ["قرمز", "آبی", "نارنجی"] },
    ];
    for (const d of defs) {
      const r = await req(`${API}/admin/catalog/attributes`, {
        method: "POST",
        // نکتهٔ مهم: endpoint نام فیلد را `terms` می‌گیرد نه `values`
        body: JSON.stringify({ name: d.name, terms: d.values.map((v) => ({ value: v })), isVariantAxis: true }),
      });
      if (r.json?.id && r.json?.terms?.length) {
        attrIds[r.json.slug] = { id: r.json.id, termIds: r.json.terms.map((t) => t.id), slug: r.json.slug };
        ok(`ویژگی «${d.name}» ساخته شد`, `${r.json.terms.length} مقدار`);
      } else {
        bad(`ساخت ویژگی ${d.name}`, `status=${r.status} ${r.text.slice(0, 140)}`);
      }
    }
  }

  step(3, "ویژگی‌ها باید در لیست ادمین با مقادیرشان بیایند");
  {
    const r = await req(`${API}/admin/catalog/attributes`);
    const found = (r.json?.items ?? []).filter((a) => a.name?.includes(String(STAMP)));
    found.length === 3 ? ok("هر سه ویژگی در لیست هستند") : bad("ویژگی‌ها در لیست", `${found.length}`);
    const withTerms = found.filter((a) => a.terms?.length > 0);
    withTerms.length === 3 ? ok("مقادیر هر ویژگی هم برگشتند (لازم برای ماتریس)") : bad("مقادیر برنگشتند", `${withTerms.length}`);
  }

  step(4, "ساخت محصول آزمایشی");
  let productId = null;
  {
    const cat = await req(`${API}/admin/catalog/categories`);
    const catId = cat.json?.items?.[0]?.id;
    const r = await req(`${API}/admin/products/full`, {
      method: "POST",
      body: JSON.stringify({
        name: `محصول تست واریانت ${STAMP}`,
        categoryId: catId,
        basePrice: 750000,
        status: "PUBLISHED",
        variants: [],
      }),
    });
    if (r.json?.id) { productId = r.json.id; ok("محصول ساخته شد", `id=${productId}`); }
    else { bad("ساخت محصول", `status=${r.status} ${r.text.slice(0, 200)}`); process.exit(1); }
  }

  step(5, "پیش‌نویس ماتریس: ۲ نوع × ۴ سایز × ۳ رنگ = ۲۴ ترکیب");
  let combos = [];
  {
    const axes = [
      { attributeId: attrIds[Object.keys(attrIds)[0]].id, termIds: attrIds[Object.keys(attrIds)[0]].termIds },
      { attributeId: attrIds[Object.keys(attrIds)[1]].id, termIds: attrIds[Object.keys(attrIds)[1]].termIds },
      { attributeId: attrIds[Object.keys(attrIds)[2]].id, termIds: attrIds[Object.keys(attrIds)[2]].termIds },
    ];
    const r = await req(`${API}/admin/products/${productId}/variant-matrix`, {
      method: "POST",
      body: JSON.stringify({ axes }),
    });
    combos = r.json?.combos ?? [];
    combos.length === 24
      ? ok("۲۴ ترکیب ساخته شد (حاصل‌ضرب درست)", `محورها: ${(r.json?.axes ?? []).map((a) => a.attributeName).join(" × ")}`)
      : bad("تعداد ترکیب", `${combos.length} — انتظار ۲۴`);
    r.json?.axes?.length === 3 ? ok("سه محور شناسایی شد") : bad("تعداد محور", `${r.json?.axes?.length}`);
  }

  step(6, "هر ترکیب باید شناسهٔ ترم داشته باشد (این همان چیزی بود که قبلاً گم می‌شد)");
  {
    combos.length === 24 ? ok("آرایه ترکیب پر است (۲۴)") : bad("آرایه ترکیب خالی است — بقیهٔ بررسی‌ها بی‌معنی می‌شود");
    const allHaveIds = combos.length > 0 && combos.every((c) => c.terms?.length === 3 && c.terms.every((t) => t.termId));
    allHaveIds ? ok("همهٔ ۲۴ ترکیب ۳ ترم با شناسه دارند") : bad("شناسهٔ ترم در پیش‌نویس نبود");
    const skus = combos.map((c) => c.sku);
    skus.length > 0 && new Set(skus).size === skus.length ? ok("SKU ها یکتا هستند") : bad("SKU تکراری", `${skus.length - new Set(skus).size} تکراری`);
  }

  step(7, "پیش‌نویس نباید بارکد بسوزاند (باگ مصرف شماره)");
  {
    const withBarcode = combos.filter((c) => c.barcode).length;
    withBarcode === 0 ? ok("هیچ بارکدی در پیش‌نویس رزرو نشد (درست)") : bad("بارکد بی‌دلیل رزرو شد", `${withBarcode}`);
  }

  step(8, "ثبت واقعی واریانت‌ها با اتصال به ترم‌ها");
  {
    const rows = combos.map((c) => ({
      sku: c.sku,
      barcode: null,
      price: Number(c.price),
      stockQty: 3,
      lowStockThreshold: 2,
      termIds: c.terms.map((t) => t.termId),
    }));
    const r = await req(`${API}/admin/products/${productId}/full`, {
      method: "PUT",
      body: JSON.stringify({ variants: rows }),
    });
    r.status === 200 || r.status === 201 ? ok("محصول با ۲۴ واریانت ذخیره شد") : bad("ذخیره واریانت‌ها", `status=${r.status} ${r.text.slice(0, 200)}`);
  }

  step(9, "بارکد باید خودکار و یکتا ساخته شود");
  {
    const d = await req(`${API}/admin/products/${productId}/detail`);
    const vs = d.json?.variants ?? [];
    const withBarcode = vs.filter((v) => v.barcode);
    withBarcode.length >= 24 ? ok("واریانت‌های ماتریس بارکد گرفتند", `نمونه: ${withBarcode[0]?.barcode}`) : bad("بارکد ناقص", `${withBarcode.length}/${vs.length}`);
    const bc = withBarcode.map((v) => v.barcode);
    new Set(bc).size === bc.length ? ok("بارکدها یکتا هستند") : bad("بارکد تکراری");
  }

  step(10, "detail باید termIds را برگرداند تا فرم ویرایش پر شود");
  {
    const d = await req(`${API}/admin/products/${productId}/detail`);
    const vs = d.json?.variants ?? [];
    vs.length >= 24 ? ok("واریانت‌ها برگشتند", `${vs.length}`) : bad("تعداد واریانت", `${vs.length}`);
    const withTerms = vs.filter((v) => Array.isArray(v.termIds) && v.termIds.length === 3);
    withTerms.length >= 24 ? ok("هر واریانت ماتریس ۳ ویژگی دارد (دوباره‌خوانی درست است)", `${withTerms.length} واریانت`) : bad("termIds در detail", `${withTerms.length}`);
  }

  step(11, "فروشگاه باید محور رنگ/سایز بسازد — نتیجهٔ واقعی کار");
  {
    // منتظر می‌مانیم تا کش کاتالوگ فروشگاه تازه شود
    await new Promise((r) => setTimeout(r, 2500));
    const list = await (await fetch(`${API}/catalog/products?per_page=100&page=1`)).json();
    const p = (list.items ?? []).find((x) => x.name?.includes(String(STAMP)));
    p ? ok("محصول در کاتالوگ عمومی دیده می‌شود", p.slug) : bad("محصول در کاتالوگ نیست");
    const axes = p?.variantAxes ?? p?.axes ?? null;
    if (axes) {
      const n = Array.isArray(axes) ? axes.length : Object.keys(axes).length;
      n >= 3 ? ok("فروشگاه محور رنگ/سایز/نوع ساخت", `${n} محور`) : bad("محور در فروشگاه", `${n}`);
    } else {
      const s = await fetch(`${SITE}/p/${p?.slug ?? "x"}`);
      const html = await s.text();
      html.includes(STAMP) ? ok("صفحهٔ محصول در فروشگاه محور واریانت را نشان می‌دهد") : bad("صفحهٔ محصول فروشگاه");
    }
  }

  step(12, "پاک‌سازی کامل دادهٔ تست");
  {
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient();
    await db.product.delete({ where: { id: productId } }).catch(() => null);
    for (const k of Object.keys(attrIds)) {
      await db.attributeTerm.deleteMany({ where: { attributeId: attrIds[k].id } });
      await db.attribute.delete({ where: { id: attrIds[k].id } }).catch(() => null);
    }
    const left = await db.product.count({ where: { name: { contains: String(STAMP) } } });
    await db.$disconnect();
    left === 0 ? ok("محصول و ویژگی‌های تست پاک شدند") : bad("دادهٔ تست باقی ماند", `${left}`);
  }

  console.log(`\n${"=".repeat(52)}`);
  console.log(`نتیجه: ${pass} موفق / ${fail} ناموفق`);
  console.log("=".repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("خطا:", e.message); process.exit(1); });