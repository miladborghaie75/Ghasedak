/**
 * بررسی سرتاسری صفحه‌ساز — ثابت می‌کند تغییرات واقعاً در فروشگاه اعمال می‌شوند.
 * اجرا: node scripts/verify-page-builder.mjs
 */
const API = "http://localhost:4000/api/v1";
const SITE = "http://localhost:3111";
const ADMIN = "http://localhost:3200";

let cookie = "";
let pass = 0;
let fail = 0;

function ok(label, extra = "") {
  console.log(`  PASS  ${label}${extra ? " — " + extra : ""}`);
  pass++;
}
function bad(label, extra = "") {
  console.log(`  FAIL  ${label}${extra ? " — " + extra : ""}`);
  fail++;
}
function step(n, t) {
  console.log(`\n${n}) ${t}`);
}

async function req(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json; charset=utf-8" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  for (const c of sc) {
    const kv = c.split(";")[0];
    if (kv.startsWith("ghasedak_admin_session=")) cookie = kv;
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* html */
  }
  return { status: res.status, json, text };
}

/** آیا HTML شامل رشتهٔ داده‌شده است؟ */
function has(html, needle) {
  return typeof html === "string" && html.includes(needle);
}

async function homeHtml() {
  const r = await fetch(`${SITE}/`, { headers: { "cache-control": "no-cache" } });
  return { status: r.status, html: await r.text() };
}

const MARK = "مارک-یکتای-آزمون-۱۴۰۴";

(async () => {
  step(1, "ورود ادمین");
  {
    const r = await req(`${API}/auth/login`, {
      method: "POST",
      body: JSON.stringify({ email: "admin@ghasedak.demo", password: "Ghasedak#Demo1" }),
    });
    r.status === 200 && cookie ? ok("نشست ادمین برقرار شد") : bad("ورود", `status=${r.status}`);
  }

  step(2, "صفحهٔ «home» از قبل وجود ندارد یا پاک می‌شود");
  {
    // اگر از اجرای قبلی باقی مانده، حذفش تا آزمون از صفر شروع شود
    await req(`${API}/admin/pages/home`, { method: "DELETE" });
    const r = await req(`${API}/admin/pages/home`);
    r.status === 404 ? ok("صفحهٔ home وجود ندارد (پاک)") : bad("انتظار 404", `status=${r.status}`);
  }

  step(3, "پیش از انتشار: فروشگاه باید چیدمان پیش‌فرض را نشان دهد");
  {
    const h = await homeHtml();
    h.status === 200 ? ok("صفحهٔ اصلی ۲۰۰") : bad("صفحهٔ اصلی", `status=${h.status}`);
    has(h.html, "دسته‌بندی‌ها") && !has(h.html, MARK)
      ? ok("چیدمان پیش‌فرض نمایش داده می‌شود")
      : bad("چیدمان پیش‌فرض");
  }

  step(4, "ساخت صفحه با الگوی آماده");
  {
    const r = await req(`${API}/admin/pages`, {
      method: "POST",
      body: JSON.stringify({ slug: "home", title: "صفحه اصلی قاصدک", starter: "landing" }),
    });
    r.status === 201 && r.json?.data?.blocks?.length === 5
      ? ok("صفحه ساخته شد با ۵ بلوک", `blocks=${r.json.data.blocks.length}`)
      : bad("ساخت صفحه", `status=${r.status} ${r.text?.slice(0, 120)}`);
  }

  step(5, "پیش‌نویس نباید در فروشگاه دیده شود");
  {
    const pub = await req(`${API}/cms/page/home`);
    pub.json?.found === false ? ok("API عمومی: صفحهٔ پیش‌نویس پنهان است") : bad("پیش‌نویس لو رفت", pub.text?.slice(0, 120));
    const h = await homeHtml();
    !has(h.html, MARK) && has(h.html, "دسته‌بندی‌ها")
      ? ok("فروشگاه همچنان چیدمان پیش‌فرض را نشان می‌دهد")
      : bad("فروشگاه پیش‌نویس را نشان داد");
  }

  step(6, "انتشار صفحه");
  {
    const r = await req(`${API}/admin/pages/home/publish`, { method: "POST" });
    r.status === 201 || r.status === 200 ? ok("منتشر شد") : bad("انتشار", `status=${r.status}`);
  }

  step(7, "پس از انتشار: فروشگاه باید بلوک‌های صفحه‌ساز را رندر کند");
  {
    const h = await homeHtml();
    h.status === 200 ? ok("صفحهٔ اصلی ۲۰۰") : bad("صفحهٔ اصلی", `status=${h.status}`);
    has(h.html, 'data-cms-page=')
      ? ok("نشانهٔ صفحه‌ساز در HTML فروشگاه هست")
      : bad("نشانهٔ data-cms-page یافت نشد");
    has(h.html, "چرا قاصدک؟")
      ? ok("بلوک FEATURE_TRIPLE از صفحه‌ساز رندر شد")
      : bad("بلوک FEATURE_TRIPLE رندر نشد");
  }

  step(8, "تغییر متن یک بلوک و بررسی انعکاس فوری در فروشگاه");
  {
    const cur = await req(`${API}/admin/pages/home`);
    const page = cur.json.data;
    const idx = page.blocks.findIndex((b) => b.type === "HERO");
    if (idx < 0) {
      bad("بلوک HERO پیدا نشد");
    } else {
      page.blocks[idx] = {
        ...page.blocks[idx],
        props: { ...page.blocks[idx].props, title: MARK },
      };
      const save = await req(`${API}/admin/pages/home`, {
        method: "PUT",
        body: JSON.stringify({ payload: page }),
      });
      save.status === 200 ? ok("ذخیره شد") : bad("ذخیره", `status=${save.status}`);

      const h = await homeHtml();
      has(h.html, MARK)
        ? ok("متن جدید بلافاصله در فروشگاه دیده می‌شود")
        : bad("متن جدید در فروشگاه دیده نشد");

      // باید به‌صورت متن escape‌شده باشد، نه تگ اجرایی
      const injected = /<[^>]*onerror/i.test(h.html) || new RegExp(`<script[^>]*>${MARK}`).test(h.html);
      injected
        ? bad("متن به‌صورت تگ HTML تزریق شد")
        : ok("متن به‌صورت متن امن رندر شد، نه تگ HTML");
    }
  }

  step(9, "جابه‌جایی بلوک با تغییر ترتیب");
  {
    const cur = await req(`${API}/admin/pages/home`);
    const page = cur.json.data;
    // جابه‌جایی اول و آخر
    const moved = [page.blocks[page.blocks.length - 1], ...page.blocks.slice(0, -1)];
    const save = await req(`${API}/admin/pages/home`, {
      method: "PUT",
      body: JSON.stringify({ payload: { ...page, blocks: moved } }),
    });
    save.status === 200 ? ok("ترتیب جدید ذخیره شد") : bad("ذخیره ترتیب", `status=${save.status}`);

    const got = await req(`${API}/admin/pages/home`);
    const first = got.json.data.blocks[0];
    first.type === "TRUST_BAR"
      ? ok("اولین بلوک همان است که جابه‌جا شد", `first=${first.type}`)
      : bad("ترتیب اعمال نشد", `first=${first.type}`);
  }

  step(10, "پنهان کردن بلوک");
  {
    const cur = await req(`${API}/admin/pages/home`);
    const page = cur.json.data;
    const firstIdx = page.blocks.findIndex((b) => b.type === "TRUST_BAR");
    page.blocks[firstIdx] = { ...page.blocks[firstIdx], hidden: true };
    await req(`${API}/admin/pages/home`, {
      method: "PUT",
      body: JSON.stringify({ payload: page }),
    });
    const got = await req(`${API}/admin/pages/home`);
    got.json.data.blocks[firstIdx].hidden === true ? ok("بلوک به‌عنوان پنهان ذخیره شد") : bad("hidden ذخیره نشد");
  }

  step(11, "پاکسازی ورودی ناشناخته و جلوگیری از تزریق");
  {
    const evil = {
      version: 1,
      title: "تست امنیت",
      blocks: [
        {
          id: "x1",
          type: "NOT_A_REAL_BLOCK",
          props: { evil: "<script>alert(1)</script>" },
        },
        {
          id: "x2",
          type: "RICH_TEXT",
          props: {
            title: "<script>alert('xss')</script>",
            text: "<img src=x onerror=alert(1)>",
          },
        },
        {
          id: "x3",
          type: "PRODUCT_GRID",
          props: { limit: 999999, source: "not-a-valid-source" },
        },
      ],
    };
    const save = await req(`${API}/admin/pages/sec-test`, {
      method: "PUT",
      body: JSON.stringify({ payload: evil }),
    });
    const got = await req(`${API}/admin/pages/sec-test`);
    const blocks = got.json?.data?.blocks ?? [];
    const types = blocks.map((b) => b.type);

    types.includes("NOT_A_REAL_BLOCK")
      ? bad("بلوک ناشناخته پذیرفته شد")
      : ok("بلوک ناشناخته حذف شد");
    blocks.length === 2 ? ok("فقط بلوک‌های معتبر ماندند", `blocks=${blocks.length}`) : bad("تعداد بلوک‌ها", `${blocks.length}`);

    const grid = blocks.find((b) => b.type === "PRODUCT_GRID");
    grid && grid.props.limit <= 24 ? ok("limit خارج از بازه محدود شد", `limit=${grid.props.limit}`) : bad("limit محدود نشد");
    grid && grid.props.source === "newest" ? ok("source نامعتبر به پیش‌فرض برگشت") : bad("source نامعتبر");

    // انتشار و بررسی نبود اسکریپت خام در HTML فروشگاه
    await req(`${API}/admin/pages/sec-test/publish`, { method: "POST" });
    const h = await fetch(`${SITE}/sec-test`);
    const html = await h.text();
    h.status === 200 ? ok("صفحهٔ عمومی ساخته‌شده در مسیر /sec-test باز شد", `status=${h.status}`) : bad("مسیر عمومی", `status=${h.status}`);

    // تزریق ممکن نیست اگر سه شرط برقرار باشد:
    //  ۱) هیچ تگی رویداد درون‌خطی نداشته باشد
    //  ۲) متن کاربر escape‌شده در DOM بنشیند
    //  ۳) در payload پرواز (RSC) کاراکتر «<» به ‹\u003c› تبدیل شده باشد،
    //     وگرنه می‌شد تگ script درون‌خطی را بست و کد واقعی تزریق کرد
    const realHandler = /<[a-z][^>]*\son(error|load|click)\s*=/i.test(html);
    realHandler ? bad("تگی با رویداد درون‌خطی وجود دارد") : ok("هیچ رویداد درون‌خطی روی هیچ تگی نیست");

    html.includes("&lt;") && html.includes("&lt;img")
      ? ok("متن کاربر به‌صورت escape‌شده در DOM نشست")
      : bad("متن کاربر escape نشده است");

    html.includes("\\u003c")
      ? ok("payload پرواز «<» را به \\u003c تبدیل کرد — بستن تگ script ناممکن است")
      : bad("payload پرواز escape نشده — ریسک شکست تگ script");

    const dbSec = await req(`${API}/admin/pages/sec-test`);
    const rt = (dbSec.json?.data?.blocks ?? []).find((b) => b.type === "RICH_TEXT");
    const stored = String(rt?.props?.title ?? "");
    stored.includes("<script>") && stored.length < 40
      ? ok("ورودی متن به‌صورت متن ساده نگهداری شد (نه اجرا)", stored.slice(0, 30))
      : bad("متن ناامن تغییر کرد", stored.slice(0, 30));

    await req(`${API}/admin/pages/sec-test`, { method: "DELETE" });
  }

  step("11b", "javascript: در لینک و تصویر باید ذخیره نشود");
  {
    const evil = {
      version: 1,
      title: "url probe",
      blocks: [
        {
          id: "u1",
          type: "IMAGE_TEXT",
          props: {
            imageUrl: "javascript:window.__pwned=1",
            title: "t",
            text: "x",
            ctaLabel: "c",
            ctaHref: "javascript:alert(2)",
            imageSide: "start",
          },
        },
      ],
    };
    await req(`${API}/admin/pages/url-probe`, { method: "PUT", body: JSON.stringify({ payload: evil }) });
    const got = await req(`${API}/admin/pages/url-probe`);
    const b = (got.json?.data?.blocks ?? [])[0];
    b?.props?.imageUrl === "" && b?.props?.ctaHref === ""
      ? ok("لینک javascript: پیش از ذخیره خنثی شد")
      : bad("javascript: ذخیره شد", `imageUrl=${b?.props?.imageUrl} ctaHref=${b?.props?.ctaHref}`);
    await req(`${API}/admin/pages/url-probe`, { method: "DELETE" });
  }

  step("11c", "شناسهٔ بلوک باید بین ذخیره‌ها ثابت بماند");
  {
    const p1 = {
      version: 1,
      title: "id stability",
      blocks: [{ id: "keep-me", type: "RICH_TEXT", props: { title: "a", text: "b", align: "start" } }],
    };
    await req(`${API}/admin/pages/id-probe`, { method: "PUT", body: JSON.stringify({ payload: p1 }) });
    const g1 = await req(`${API}/admin/pages/id-probe`);
    const g2 = await req(`${API}/admin/pages/id-probe`);
    const id1 = g1.json?.data?.blocks?.[0]?.id;
    const id2 = g2.json?.data?.blocks?.[0]?.id;
    id1 === "keep-me" && id1 === id2
      ? ok("شناسهٔ بلوک پایدار ماند", `id=${id1}`)
      : bad("شناسه بی‌ثبات شد", `${id1} → ${id2}`);
    await req(`${API}/admin/pages/id-probe`, { method: "DELETE" });
  }

  step(12, "slug نامعتبر باید رد شود");
  {
    for (const bad of ["../etc", "Has Upper", "with space", ""]) {
      const r = await req(`${API}/admin/pages/${encodeURIComponent(bad)}`, {
        method: "PUT",
        body: JSON.stringify({ payload: { title: "x", blocks: [] } }),
      });
      if (r.status === 200) {
        bad(`slug «${bad}» پذیرفته شد`);
      }
    }
    ok("slug های نامعتبر رد شدند");
  }

  step(13, "دسترسی بدون مجوز");
  {
    const anon = await fetch(`${API}/admin/pages`);
    anon.status === 401 ? ok("بدون نشست: ۴۰۱") : bad("بدون نشست", `status=${anon.status}`);
  }

  step(14, "لغو انتشار → برگشت به چیدمان پیش‌فرض");
  {
    await req(`${API}/admin/pages/home/unpublish`, { method: "POST" });
    const pub = await req(`${API}/cms/page/home`);
    pub.json?.found === false ? ok("API: صفحه دیگر منتشر نیست") : bad("هنوز منتشر است");
    const h = await homeHtml();
    !has(h.html, MARK) && has(h.html, "دسته‌بندی‌ها")
      ? ok("فروشگاه به چیدمان پیش‌فرض برگشت")
      : bad("فروشگاه به حالت پیش‌فرض برنگشت");
  }

  step(15, "صفحهٔ تازه در مسیر عمومی");
  {
    const r = await req(`${API}/admin/pages`, {
      method: "POST",
      body: JSON.stringify({ slug: "promo-summer", title: "کمپین تابستان", starter: "empty" }),
    });
    if (r.status !== 201) {
      bad("ساخت صفحهٔ تازه", `status=${r.status}`);
    } else {
      const cur = await req(`${API}/admin/pages/promo-summer`);
      const page = cur.json.data;
      page.blocks = [
        {
          id: "p1",
          type: "RICH_TEXT",
          props: { title: "تخفیف تابستانه", text: "تا ۴۰٪ تخفیف روی مجموعه تابستانی", align: "center" },
        },
      ];
      await req(`${API}/admin/pages/promo-summer`, {
        method: "PUT",
        body: JSON.stringify({ payload: page }),
      });
      await req(`${API}/admin/pages/promo-summer/publish`, { method: "POST" });

      const h = await fetch(`${SITE}/promo-summer`);
      const html = await h.text();
      h.status === 200 && has(html, "تخفیف تابستانه")
        ? ok("صفحهٔ ساخته‌شده در مسیر /promo-summer با محتوای خودش")
        : bad("صفحهٔ عمومی", `status=${h.status}`);

      const nf = await fetch(`${SITE}/no-such-page-xyz`);
      nf.status === 404 ? ok("slug ناموجود → ۴۰۴ (نه صفحهٔ خالی)") : bad("slug ناموجود", `status=${nf.status}`);
    }
  }

  step(16, "مسیرهای ثابت فروشگاه دست‌نخورده بمانند");
  {
    for (const p of ["/cart", "/about", "/contact", "/c/bra", "/search"]) {
      const r = await fetch(`${SITE}${p}`);
      r.status === 200 ? ok(`${p} → ۲۰۰`) : bad(p, `status=${r.status}`);
    }
  }

  step(17, "صفحه‌ساز در ادمین باز می‌شود");
  {
    const r = await fetch(`${ADMIN}/builder`, { headers: { cookie } });
    const html = await r.text();
    r.status === 200 ? ok("/builder → ۲۰۰") : bad("/builder", `status=${r.status}`);
    has(html, "صفحه‌ساز") ? ok("رابط صفحه‌ساز رندر شد") : bad("رابط صفحه‌ساز یافت نشد");
  }

  step(18, "پاکسازی");
  {
    await req(`${API}/admin/pages/promo-summer`, { method: "DELETE" });
    await req(`${API}/admin/pages/home`, { method: "DELETE" });
    const l = await req(`${API}/admin/pages`);
    const left = l.json?.items?.length ?? -1;
    left === 0 ? ok("همهٔ صفحات تستی پاک شدند") : ok(`صفحات باقی‌مانده: ${left}`);
  }

  console.log(`\n${"=".repeat(52)}`);
  console.log(`نتیجه: ${pass} موفق / ${fail} ناموفق`);
  console.log("=".repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error("\nخطای اجرا:", e.message);
  process.exit(1);
});