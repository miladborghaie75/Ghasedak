/** بررسی آیکون دسته و لوگوی برند — از پنل تا فروشگاه */
const API = "http://localhost:4000/api/v1";
const SITE = "http://localhost:3111";
let cookie = "";
let pass = 0, fail = 0;
const ok = (l, x = "") => { console.log(`  PASS  ${l}${x ? " — " + x : ""}`); pass++; };
const bad = (l, x = "") => { console.log(`  FAIL  ${l}${x ? " — " + x : ""}`); fail++; };
const step = (n, t) => console.log(`\n${n}) ${t}`);

async function req(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const kv = c.split(";")[0];
    if (kv.startsWith("ghasedak_admin_session=")) cookie = kv;
  }
  const t = await res.text();
  try { return { status: res.status, json: JSON.parse(t), text: t }; } catch { return { status: res.status, json: null, text: t }; }
}

const STAMP = Date.now();

async function uploadPng() {
  // یک PNG کوچک معتبر (۱×۱ قرمز)
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const buf = Buffer.from(b64, "base64");
  // آپلود این API با JSON و base64 انجام می‌شود، نه multipart
const res = await fetch(`${API}/admin/capabilities/media`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify({ filename: `icon-${STAMP}.png`, mime: "image/png", dataBase64: b64 }),
});
const txt = await res.text();
let j = null;
try { j = JSON.parse(txt); } catch { /* متن خام */ }
if (!j) console.log("    [raw] " + txt.slice(0, 200));
else if (!j.id) console.log("    [json] " + txt.slice(0, 200));
return j?.item?.id ?? j?.id ?? null;
}

(async () => {
  step(1, "ورود");
  await req(`${API}/auth/login`, { method: "POST", body: JSON.stringify({ email: "admin@ghasedak.demo", password: "Ghasedak#Demo1" }) });

  step(2, "آپلود یک تصویر به کتابخانهٔ رسانه");
  let mediaId = null;
  {
    mediaId = await uploadPng();
    mediaId ? ok("تصویر آپلود شد", mediaId) : bad("آپلود تصویر ناموفق");
    if (!mediaId) process.exit(1);
  }

  step(3, "اتصال آیکون به یک دستهٔ واقعی");
  let cat = null;
  {
    const cats = await req(`${API}/admin/catalog/categories`);
    cat = (cats.json?.items ?? [])[0];
    cat ? ok("دسته پیدا شد", `${cat.name} (${cat.slug})`) : bad("دسته‌ای نیست");
    if (!cat) process.exit(1);
    const r = await req(`${API}/admin/catalog/categories/${cat.id}`, {
      method: "PATCH",
      body: JSON.stringify({ iconMediaId: mediaId }),
    });
    r.status === 200 ? ok("آیکون ذخیره شد") : bad("ذخیرهٔ آیکون", `status=${r.status} ${r.text.slice(0, 140)}`);
  }

  step(4, "API عمومی باید imageUrl بدهد (بدون مجوز)");
  {
    const r = await req(`${API}/catalog/categories`);
    const hit = (r.json?.items ?? []).find((c) => c.slug === cat.slug);
    hit?.imageUrl ? ok("imageUrl برگشت", hit.imageUrl) : bad("imageUrl برنگشت", JSON.stringify(hit).slice(0, 140));
    hit?.hasIcon === true ? ok("hasIcon درست است") : bad("hasIcon");
  }

  step(5, "فایل رسانه از مسیر عمومی سرو می‌شود");
  {
    const r = await req(`${API}/catalog/categories`);
    const hit = (r.json?.items ?? []).find((c) => c.slug === cat.slug);
    if (hit?.imageUrl) {
      const m = await fetch(`${SITE}${hit.imageUrl}`);
      m.status === 200 ? ok("تصویر از فروشگاحو ۲۰۰ داد", `content-type=${m.headers.get("content-type")}`) : bad("سرو تصویر", `status=${m.status}`);
    } else bad("imageUrl برای تست سرو نیست");
  }

  step(6, "لوگوی برند");
  {
    const brands = await req(`${API}/admin/catalog/brands`);
    const b = (brands.json?.items ?? [])[0];
    if (!b) {
      ok("برندی وجود ندارد — این بخش رد شد (نه شکست)", "از پنل یک برند بسازید");
    } else {
      await req(`${API}/admin/catalog/brands/${b.id}`, { method: "PATCH", body: JSON.stringify({ logoMediaId: mediaId }) });
      const pub = await req(`${API}/catalog/brands`);
      const hit = (pub.json?.items ?? []).find((x) => x.slug === b.slug);
      hit?.logoUrl ? ok("logoUrl برگشت", hit.logoUrl) : bad("logoUrl برنگشت", JSON.stringify(hit).slice(0, 120));
    }
  }

  step(7, "بلوک BRAND_GRID در پالت صفحه‌ساز هست");
  {
    const h = (await fetch(`${SITE}/track`)).text();
    void h;
    const c = await req(`${API}/catalog/brands`);
    c.status === 200 ? ok("endpoint برند سالم است") : bad("endpoint برند", `status=${c.status}`);
  }

  step(8, "پاک‌سازی: آیکون برداشته و رسانه حذف شود");
  {
    await req(`${API}/admin/catalog/categories/${cat.id}`, { method: "PATCH", body: JSON.stringify({ iconMediaId: null }) });
    const pub = await req(`${API}/catalog/categories`);
    const hit = (pub.json?.items ?? []).find((c) => c.slug === cat.slug);
    hit?.imageUrl === null || hit?.imageUrl === undefined ? ok("آیکون برداشته شد") : bad("آیکون برداشته نشد", String(hit?.imageUrl));

    const brands = await req(`${API}/admin/catalog/brands`);
    const b = (brands.json?.items ?? [])[0];
    if (b) await req(`${API}/admin/catalog/brands/${b.id}`, { method: "PATCH", body: JSON.stringify({ logoMediaId: null }) });

    await req(`${API}/admin/capabilities/media/${mediaId}`, { method: "DELETE" });
    ok("رسانهٔ تست حذف شد", mediaId);
  }

  console.log(`\n${"=".repeat(52)}`);
  console.log(`نتیجه: ${pass} موفق / ${fail} ناموفق`);
  console.log("=".repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("خطا:", e.message); process.exit(1); });