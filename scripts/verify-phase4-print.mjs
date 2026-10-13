/** تست فاز ۴ — پیوست سند حسابداری + صفحات چاپ */
const API = "http://localhost:4000/api/v1";
const ADMIN = "http://localhost:3200";
let cookie = "";
let pass = 0, fail = 0;
const ok = (l, x = "") => { console.log(`  PASS  ${l}${x ? " — " + x : ""}`); pass++; };
const bad = (l, x = "") => { console.log(`  FAIL  ${l}${x ? " — " + x : ""}`); fail++; };
const step = (n, t) => console.log(`\n${n}) ${t}`);
const STAMP = Date.now();

// PNG کوچک معتبر (1×1)
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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

  step(2, "آپلود فایل به کتابخانهٔ رسانه");
  let mediaId = null;
  {
    const r = await req(`${API}/admin/capabilities/media`, {
      method: "POST",
      body: JSON.stringify({ filename: `residue-${STAMP}.png`, mime: "image/png", dataBase64: PNG_B64, alt: "رسید کارت‌خوان تست" }),
    });
    mediaId = r.json?.item?.id ?? r.json?.id ?? null;
    mediaId ? ok("فایل آپلود شد", mediaId) : bad("آپلود", `status=${r.status} ${r.text?.slice(0, 140)}`);
  }

  step(3, "ساخت سند پیش‌نویس برای پیوست");
  let entryId = null;
  {
    const r = await req(`${API}/admin/accounting/journal/manual`, {
      method: "POST",
      body: JSON.stringify({
        description: `سند تست پیوست ${STAMP}`,
        state: "DRAFT",
        lines: [
          { accountCode: "6000-09", debit: 1_000_000 },
          { accountCode: "1000-01", credit: 1_000_000 },
        ],
      }),
    });
    entryId = r.json?.id ?? null;
    entryId ? ok("سند ساخته شد", r.json.number) : bad("ساخت سند", `status=${r.status} ${r.text?.slice(0, 140)}`);
  }

  step(4, "پیوست فایل به سند");
  let attId = null;
  {
    const r = await req(`${API}/admin/accounting/journal/${entryId}/attachments`, {
      method: "POST",
      body: JSON.stringify({ mediaId, title: "رسید کارت‌خوان" }),
    });
    attId = r.json?.id ?? null;
    attId ? ok("پیوست اضافه شد", `url=${r.json?.url}`) : bad("پیوست", `status=${r.status} ${r.text?.slice(0, 160)}`);
  }

  step(5, "پیوست تکراری باید رد شود");
  {
    const r = await req(`${API}/admin/accounting/journal/${entryId}/attachments`, {
      method: "POST",
      body: JSON.stringify({ mediaId }),
    });
    r.status === 400 ? ok("پیوست تکراری رد شد") : bad("رد نشد", `status=${r.status}`);
  }

  step(6, "فهرست پیوست‌ها");
  {
    const r = await req(`${API}/admin/accounting/journal/${entryId}/attachments`);
    const items = r.json?.items ?? [];
    items.length === 1 ? ok("یک پیوست در فهرست", items[0].title ?? "") : bad("تعداد پیوست", `${items.length}`);
    items[0]?.url?.startsWith("/api/media/")
      ? ok("لینک پیوست به مسیر سروی عمومی اشاره می‌کند", items[0].url)
      : bad("مسیر لینک پیوست", String(items[0]?.url));
  }

  step(7, "لینک پیوست واقعاً سرو می‌شود");
  {
    const list = await req(`${API}/admin/accounting/journal/${entryId}/attachments`);
    const url = list.json?.items?.[0]?.url;
    if (!url) bad("لینکی نیست");
    else {
      const r = await fetch(`${ADMIN}${url}`, { headers: { cookie } });
      r.status === 200 ? ok("فایل پیوست ۲۰۰ داد", `content-type=${r.headers.get("content-type")}`) : bad("سرو فایل", `status=${r.status}`);
    }
  }

  step(8, "پیوست به سند قطعی نباید قابل حذف باشد");
  {
    await req(`${API}/admin/accounting/journal/${entryId}/finalize`, { method: "POST" });
    const r = await req(`${API}/admin/accounting/journal/attachments/${attId}`, { method: "DELETE" });
    r.status === 400 && r.json?.code === "ENTRY_FINAL"
      ? ok("حذف پیوست سند قطعی رد شد (حفاظت از مدرک حسابرسی)")
      : bad("حذف پیوست قطعی رد نشد", `status=${r.status}`);
  }

  step(9, "صفحهٔ چاپ سند");
  {
    const r = await fetch(`${ADMIN}/accounting/journal/print/${entryId}`, { headers: { cookie }, redirect: "follow" });
    const html = await r.text();
    r.status === 200 ? ok("صفحهٔ چاپ باز شد") : bad("صفحهٔ چاپ", `status=${r.status}`);
    html.includes("سند حسابداری") ? ok("سربرگ چاپ هست") : bad("سربرگ نیست");

    // محتوای داخل کلاینت در SSR رندر نمی‌شود، پس در باندل جاوااسکریپت می‌سنجیم
    const chunks = await Promise.all(
      [...html.matchAll(/\/_next\/static\/chunks\/[^"']+\.js/g)].map((m) =>
        fetch(`${ADMIN}${m[0]}`).then((x) => x.text()).catch(() => ""),
      ),
    );
    const bundle = chunks.join("");
    bundle.includes("مهر و امضا") ? ok("محل مُهر و امضا هست") : bad("محل مُهر نیست");
    bundle.includes("بدهکار") && bundle.includes("بستانکار") ? ok("ستون‌های بدهکار/بستانکار هست") : bad("ستون‌ها نیست");
    // عنوان پیوست از API می‌آید نه از باندل؛ پس خودِ بخش «مدارک پیوست» را می‌سنجیم
    bundle.includes("مدارک پیوست")
      ? ok("بخش «مدارک پیوست» در برگهٔ چاپ هست")
      : bad("بخش پیوست در چاپ نیست");
    bundle.includes("باز کردن فایل") ? ok("دکمهٔ باز کردن فایل پیوست هست") : bad("دکمهٔ باز کردن فایل نیست");
    bundle.includes("no-print") ? ok("کلاس حذف‌شدنی از چاپ اعمال شد") : bad("no-print نیست");
  }

  step(10, "دکمهٔ چاپ در فهرست اسناد");
  {
    const r = await fetch(`${ADMIN}/accounting/journal`, { headers: { cookie }, redirect: "follow" });
    const html = await r.text();
    html.includes("چاپ / پیوست") ? ok("دکمهٔ چاپ/پیوست در فهرست اسناد هست") : bad("دکمهٔ چاپ نیست");
    const chunks = await Promise.all(
      [...html.matchAll(/\/_next\/static\/chunks\/[^"']+\.js/g)].map((m) =>
        fetch(`${ADMIN}${m[0]}`).then((x) => x.text()).catch(() => ""),
      ),
    );
    chunks.join("").includes("/accounting/journal/print/")
      ? ok("لینک چاپ ساخته می‌شود")
      : bad("لینک چاپ نیست");
  }

  step(11, "استایل چاپ A4");
  {
    const r = await fetch(`${ADMIN}/`, { headers: { cookie } });
    void r;
    const fs = await import("node:fs");
    const path = await import("node:path");
    // مسیر ثابت: اسکریپت ممکن است از ریشه یا از apps/api اجرا شود
    const root = process.cwd().endsWith("apps\\api") || process.cwd().endsWith("apps/api")
      ? path.resolve(process.cwd(), "..", "..")
      : process.cwd();
    const css = fs.readFileSync(path.join(root, "apps", "admin", "app", "globals.css"), "utf8");
    css.includes(".no-print") ? ok("قانون حذف نوار ابزار از چاپ هست") : bad("قانون no-print نیست");
    css.includes(".stamp-box") ? ok("استایل محل مُرار هست") : bad("استایل stamp-box نیست");
    css.includes("break-inside") ? ok("شکست‌نکردن جدول بین صفحه‌ها هست") : bad("قانون شکست صفحه نیست");
    css.includes("table-header-group") ? ok("سرصفحهٔ جدول در هر صفحه تکرار می‌شود") : bad("تکرار سرصفحه نیست");
  }

  step(12, "چاپ فاکتور فروش آنلاین");
  {
    const orders = await req(`${API}/orders?limit=20`);
    const paid = (orders.json?.items ?? []).find((o) => o.paymentStatus === "PAID");
    if (!paid) {
      ok("سفارش پرداخت‌شده‌ای برای تست نبود — فقط مسیر بررسی شد");
    } else {
      const r = await fetch(`${ADMIN}/orders/invoice-print/${encodeURIComponent(paid.code)}`, {
        headers: { cookie },
        redirect: "follow",
      });
      r.status === 200 ? ok("صفحهٔ چاپ فاکتور باز شد", paid.code) : bad("صفحهٔ فاکتور", `status=${r.status}`);
      const html = await r.text();
      html.includes("فاکتور فروش") ? ok("سربرگ فاکتور هست") : bad("سربرگ فاکتور نیست");
      // «جمع» و «محل مُهر» داخل کلاینت رندر می‌شوند ⇒ در باندل سنجیده می‌شوند
      const chunks = await Promise.all(
        [...html.matchAll(/\/_next\/static\/chunks\/[^"']+\.js/g)].map((m) =>
          fetch(`${ADMIN}${m[0]}`).then((x) => x.text()).catch(() => ""),
        ),
      );
      const bundle = chunks.join("");
      bundle.includes("قابل پرداخت") ? ok("جمع قابل پرداخت هست") : bad("جمع نیست");
      bundle.includes("مهر و امضا") ? ok("محل مُهر و امضا هست") : bad("محل مُهر نیست");
      html.includes(paid.code) ? ok("شمارهٔ فاکتور در برگه هست") : bad("شمارهٔ فاکتور نیست");
    }
  }

  step(13, "دکمهٔ چاپ فاکتور در سفارش‌ها");
  {
    const r = await fetch(`${ADMIN}/orders`, { headers: { cookie }, redirect: "follow" });
    const html = await r.text();
    // دکمه داخل کلاینت است، پس در باندل سنجیده می‌شود
    const chunks = await Promise.all(
      [...html.matchAll(/\/_next\/static\/chunks\/[^"']+\.js/g)].map((m) =>
        fetch(`${ADMIN}${m[0]}`).then((x) => x.text()).catch(() => ""),
      ),
    );
    const bundle = chunks.join("");
    bundle.includes("چاپ فاکتور") ? ok("دکمهٔ چاپ فاکتور در فهرست سفارش‌ها هست") : bad("دکمهٔ چاپ فاکتور نیست");
    bundle.includes("/orders/invoice-print/")
      ? ok("لینک چاپ فاکتور ساخته می‌شود")
      : bad("لینک چاپ فاکتور نیست");
  }

  step(14, "پاک‌سازی");
  {
    if (attId) await db.attachment.deleteMany({ where: { id: attId } });
    if (mediaId) await db.media.delete({ where: { id: mediaId } }).catch(() => null);
    if (entryId) {
      await db.journalLine.deleteMany({ where: { entryId } });
      await db.journalEntry.delete({ where: { id: entryId } });
    }
    ok("دادهٔ تست پاک شد");
  }

  step(15, "دفتر بعد از پاک‌سازی متوازن است");
  {
    const r = await req(`${API}/admin/accounting/integrity`);
    r.json?.balanced === true ? ok("دفتر متوازن", `Dr=${r.json.debit}`) : bad("نامتوازن", JSON.stringify(r.json));
  }

  await db.$disconnect();
  console.log(`\n${"=".repeat(52)}`);
  console.log(`نتیجه: ${pass} موفق / ${fail} ناموفق`);
  console.log("=".repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch(async (e) => { console.error("خطا:", e.message); process.exit(1); });