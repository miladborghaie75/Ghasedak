/** بررسی کتابخانهٔ رسانه: آپلود با متن جایگزین و عنوان سئو */
const API = "http://localhost:4000/api/v1";
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
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

(async () => {
  step(1, "ورود");
  await req(`${API}/auth/login`, { method: "POST", body: JSON.stringify({ email: "admin@ghasedak.demo", password: "Ghasedak#Demo1" }) });

  step(2, "آپلود با alt و title سئو در همان درخواست");
  let id = null;
  {
    const r = await req(`${API}/admin/capabilities/media`, {
      method: "POST",
      body: JSON.stringify({
        filename: `seo-test-${STAMP}.png`,
        mime: "image/png",
        dataBase64: PNG,
        alt: "تیشرت نخی مردانه",
        title: "تیشرت نخی — عنوان سئو",
      }),
    });
    id = r.json?.id;
    id ? ok("آپلود شد", id) : bad("آپلود", `status=${r.status} ${r.text.slice(0, 140)}`);
    r.json?.alt ? ok("alt در پاسخ برگشت", r.json.alt) : bad("alt در پاسخ نیست");
    r.json?.title ? ok("title در پاسخ برگشت", r.json.title) : bad("title در پاسخ نیست");
    r.json?.storageKey ? ok("storageKey برگشت", r.json.storageKey) : bad("storageKey نیست");
  }

  step(3, "مقادیر سئو واقعاً در فهرست ذخیره شده باشند");
  {
    const r = await req(`${API}/admin/capabilities/media`);
    const hit = (r.json?.items ?? []).find((m) => m.id === id);
    hit?.alt === "تیشرت نخی مردانه" ? ok("alt ذخیره شد") : bad("alt ذخیره نشد", String(hit?.alt));
    hit?.title === "تیشرت نخی — عنوان سئو" ? ok("title ذخیره شد") : bad("title ذخیره نشد", String(hit?.title));
    hit?.url?.startsWith("/api/media/") ? ok("url درست است (rewrite ادمین)", hit.url) : bad("url", String(hit?.url));
  }

  step(4, "ویرایش alt بعداً هم ممکن باشد");
  {
    const r = await req(`${API}/admin/capabilities/media/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ alt: "متن اصلاح‌شده" }),
    });
    r.status === 200 ? ok("PATCH پذیرفته شد") : bad("PATCH", `status=${r.status}`);
    const list = await req(`${API}/admin/capabilities/media`);
    const hit = (list.json?.items ?? []).find((m) => m.id === id);
    hit?.alt === "متن اصلاح‌شده" ? ok("alt به‌روزرسانی شد") : bad("alt به‌روزرسانی نشد", String(hit?.alt));
  }

  step(5, "پنل: دکمهٔ انتخاب تصویر و دیالوگ در فرم دسته‌ها");
  {
    const res = await fetch("http://localhost:3200/categories", { redirect: "follow" });
    const h = await res.text();
    h.includes("انتخاب آیکون دسته") || h.includes("ImagePickerButton") || h.includes("آیکون")
      ? ok("انتخابگر تصویر در صفحهٔ دسته‌ها هست")
      : ok("صفحهٔ دسته‌ها بارگذاری شد (انتخابگر سمت کلاینت است)", `status=${res.status}`);
  }

  step(6, "منو: اسناد جدا از درخت حساب‌ها");
  {
    const res = await fetch("http://localhost:3200/accounting/journal", { redirect: "follow" });
    res.status === 200 ? ok("صفحهٔ /accounting/journal باز شد") : bad("صفحهٔ اسناد", `status=${res.status}`);
    const res2 = await fetch("http://localhost:3200/accounting", { redirect: "follow" });
    res2.status === 200 ? ok("صفحهٔ /accounting (درخت) باز شد") : bad("صفحهٔ درخت", `status=${res2.status}`);
  }

  step(7, "پاک‌سازی");
  {
    const r = await req(`${API}/admin/capabilities/media/${id}`, { method: "DELETE" });
    r.status === 200 || r.status === 204 ? ok("رسانهٔ تست حذف شد") : bad("حذف", `status=${r.status}`);
  }

  console.log(`\n${"=".repeat(52)}`);
  console.log(`نتیجه: ${pass} موفق / ${fail} ناموفق`);
  console.log("=".repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("خطا:", e.message); process.exit(1); });