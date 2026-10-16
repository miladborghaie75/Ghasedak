/**
 * تست بصری «هندسهٔ کارت گرید» — بند ۱۱/۴۱/۸۸.
 *
 * چه چیزی را نگه می‌دارد: کارت محصولِ امتیازدار و بی‌امتیاز (و هر ترکیب دیگر
 * ردیف‌های بدنه) باید هم‌اندازه و هم‌تراز بماند. سنجه‌ها:
 *   - عرض و ارتفاع همهٔ کارت‌های یک لیست یکسان است
 *   - آفست عمودی «ردیف امتیاز» از بالای کارت بین همهٔ کارت‌ها یکسان است
 *   - آفست عمودی «دکمهٔ خرید» از بالای کارت بین همهٔ کارت‌ها یکسان است
 *   - سرریز افقی وجود ندارد (موبایل)
 *   - تمِ درخواستی واقعاً اعمال شده است (data-theme)
 * در چند عرض و هر دو تم تکرار می‌شود تا شکستن قرینه‌سازی در هیچ بریک‌پوینتی پنهان نماند.
 *
 * اجرا:
 *   node apps/storefront/scripts/visual-card-parity.mjs [BASE_URL] [PATH]
 *   مثال: node apps/storefront/scripts/visual-card-parity.mjs http://127.0.0.1:3111 "/search?q=تست&sort=rating"
 *   SELFTEST=1 → شبیه‌سازی باگ قدیمی (حذف ردیف امتیاز کارت بی‌امتیاز) تا مطمئن شویم
 *                آشکارساز واقعاً می‌گیرد. در این حالت «سبز بودن» یعنی باگ گرفته شد.
 *   BREAK_GEOMETRY=1 → همان تزریق، ولی با معنای عادی: باید FAIL بدهد و کد خروج ۱ داشته باشد
 *                (اثبات این‌که مسیر شکست در CI واقعاً غیرصفر می‌شود).
 *   REQUIRE_MIXED=0 → پیش‌فرض این است که لیست باید هم کارت امتیازدار و هم بی‌امتیاز داشته باشد؛
 *                روی محیط بدون دادهٔ امتیاز، با این متغیر خاموش می‌شود (تست معنایش را از دست می‌دهد).
 *   SHOTS=1    → اسکرین‌شات هر حالت در .visual/ ذخیره می‌شود (برای چشم انسان).
 *
 * پیش‌نیاز: سرور فروشگاه بالا باشد + Chrome یا Edge نصب‌شده.
 * بدون وابستگی بیرونی: از پروتکل CDP خودِ مرورگر و WebSocket توکار Node استفاده می‌کند
 * (هم‌سبک با infrastructure/e2e/*.mjs — PASS/FAIL صریح و کد خروج غیرصفر برای شکست).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = (process.argv[2] ?? process.env.BASE_URL ?? "http://127.0.0.1:3111").replace(/\/$/, "");
const PATH = process.argv[3] ?? process.env.CARDS_PATH ?? "/search?q=%D8%AA%D8%B3%D8%AA&sort=rating";
const SELFTEST = process.env.SELFTEST === "1";
const INJECT_REGRESSION_MODE = SELFTEST || process.env.BREAK_GEOMETRY === "1";
const SHOTS = process.env.SHOTS === "1";
const MIN_CARDS = Number(process.env.MIN_CARDS ?? 2);
// به‌طور پیش‌فرض هر دو نوع کارت لازم است؛ وگرنه تست سبزِ گمراه‌کننده می‌دهد:
// ناهم‌ترازی همان چیزی است که فقط در حضور «امتیازدار + بی‌امتیاز» دیده می‌شود.
// روی محیطی که دادهٔ دموی امتیازدار ندارد: REQUIRE_MIXED=0
const REQUIRE_MIXED = process.env.REQUIRE_MIXED !== "0";
const TOL = 1; // پیکسل — گردکردن زیرپیکسلی
const CASES = [
  { width: 390, height: 844, theme: "dark" },
  { width: 390, height: 844, theme: "light" },
  { width: 768, height: 900, theme: "dark" },
  // 768/light عمداً هست: ماتریس پذیرش «۳ عرض × ۲ تم» است؛ بدون این حالت
  // نسخهٔ تبلت-روشن (تنها ترکیبی که فونت ارقام/ستاره را در تم روشن می‌چیند)
  // بی‌گارد می‌ماند و تستْ ۵ حالت گزارش می‌کرد نه ۶.
  { width: 768, height: 900, theme: "light" },
  { width: 1280, height: 900, theme: "dark" },
  { width: 1280, height: 900, theme: "light" },
];

const CANDIDATE_BROWSERS = [
  process.env.BROWSER_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** جایگزین سبک playwright-core: اتصال مستقیم به CDP همان مرورگرِ نصب‌شده */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", () => rej(new Error("CDP websocket error")), { once: true });
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? "")})`)) : res(msg.result);
    } else if (msg.method && listeners.has(msg.method)) {
      for (const fn of listeners.get(msg.method)) fn(msg.params);
    }
  });
  return {
    send: (method, params = {}) =>
      new Promise((res, rej) => {
        const mid = ++id;
        pending.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method, params }));
        setTimeout(() => {
          if (pending.has(mid)) {
            pending.delete(mid);
            rej(new Error(`CDP timeout: ${method}`));
          }
        }, 30_000);
      }),
    on: (method, fn) => {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(fn);
    },
    close: () => ws.close(),
  };
}

async function pageTargetUrl(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* هنوز بالا نیامده */
    }
    await sleep(250);
  }
  throw new Error(`مرورگر در ۱۵ ثانیه هدف صفحه نداد (port ${port})`);
}

const MEASURE = `(() => {
  const cards = [...document.querySelectorAll('article')];
  const rows = cards.map((c) => {
    const r = c.getBoundingClientRect();
    const star = c.querySelector('[aria-label^="میانگین امتیاز"], [aria-label^="هنوز نظری"]');
    // ردیف ثابت‌ارتفاعِ امتیاز، والدِ همان عنصرِ برچسب‌دار است (هم برای امتیاز دار، هم بی‌امتیاز)
    const starRow = star ? (star.parentElement ?? star) : null;
    const btn = c.querySelector('button[aria-live]');
    return {
      rated: /میانگین امتیاز/.test(c.innerHTML),
      w: Math.round(r.width), h: Math.round(r.height),
      starOffset: starRow ? Math.round(starRow.getBoundingClientRect().top - r.top) : null,
      btnOffset: btn ? Math.round(btn.getBoundingClientRect().top - r.top) : null,
    };
  });
  return {
    cards: rows,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    theme: document.documentElement.getAttribute('data-theme'),
    title: document.title,
    // عیب‌یابی: صفحهٔ خالی/بارگذاری‌نشده باید خودش را لو بدهد، نه صرفاً «۰ کارت»
    url: location.href,
    readyState: document.readyState,
    htmlLen: document.documentElement ? document.documentElement.innerHTML.length : 0,
    bodyText: (document.body?.innerText ?? '').slice(0, 120).replace(/\s+/g, ' '),
  };
})()`;

/**
 * شبیه‌سازی باگ قدیمی: کارت بی‌امتیاز ردیف امتیاز را نداشت → نه ردیف، نه ارتفاع یکسان.
 * عمداً با display:none پنهان می‌شود (نه صفرکردن ارتفاع) تا همان چیزی شبیه‌سازی شود که
 * واقعاً رخ داده بود: ردیفی وجود ندارد — در این حالت هم تست حضور ردیف و هم هندسه را می‌گیرد.
 */
const INJECT_REGRESSION = `(() => {
  let n = 0;
  for (const c of document.querySelectorAll('article')) {
    if (/میانگین امتیاز/.test(c.innerHTML)) continue;
    const row = c.querySelector('[aria-label^="هنوز نظری"]')?.parentElement;
    if (row) { row.style.display = 'none'; n++; }
  }
  return n;
})()`;

function unique(values) {
  return [...new Set(values.filter((v) => v !== null))];
}

/** یکسان‌بودن مقادیر با تلورانسِ نیم‌پیکسل — پیام خطا یا null */
function spread(name, values) {
  if (values.length === 0) return `${name}: هیچ مقداری پیدا نشد (سلکتور عوض شده؟)`;
  if (Math.max(...values) - Math.min(...values) > TOL) return `${name} یکدست نیست: ${values.join(", ")}`;
  return null;
}

function checkCase(c, m) {
  const cards = m.cards;
  const widths = unique(cards.map((x) => x.w));
  const heights = unique(cards.map((x) => x.h));
  const starOffsets = unique(cards.map((x) => x.starOffset));
  const btnOffsets = unique(cards.map((x) => x.btnOffset));

  // حضور ردیف‌ها جدا سنجیده می‌شود: آفست‌ها به‌تنهایی کافی نیستند، چون در برخی عرض‌ها
  // کشیده‌شدن کارت‌ها در ردیف گرید + mt-auto دکمه را پایین نگه می‌دارد و اختلاف را می‌پوشاند.
  // باگ اصلی هم همین بود: کارت بی‌امتیاز اصلاً ردیف امتیاز نداشت (نه اینکه جابه‌جا باشد).
  const missingStar = cards.filter((x) => x.starOffset === null).length;
  const missingBtn = cards.filter((x) => x.btnOffset === null).length;

  const problems = [
    cards.length < MIN_CARDS ? `فقط ${cards.length} کارت پیدا شد (حداقل ${MIN_CARDS})` : null,
    missingStar > 0 ? `${missingStar} کارت ردیف امتیاز ندارد — کارت بی‌امتیاز هم باید همان ردیف را داشته باشد` : null,
    missingBtn > 0 ? `${missingBtn} کارت دکمهٔ خرید ندارد — یعنی ساختار کارت ناهمسان شده` : null,
    spread("عرض کارت‌ها", widths),
    spread("ارتفاع کارت‌ها", heights),
    spread("آفست ردیف امتیاز", starOffsets),
    spread("آفست دکمهٔ خرید", btnOffsets),
    m.overflow ? "سرریز افقی صفحه" : null,
    m.theme === c.theme ? null : `تم اعمال‌شده «${m.theme}» ≠ درخواستی «${c.theme}»`,
    REQUIRE_MIXED && cards.filter((x) => x.rated).length === 0
      ? "کارت امتیازدار در این لیست نیست — تست همین ترکیب را می‌سنجد (با REQUIRE_MIXED=0 خاموش می‌شود)"
      : null,
    REQUIRE_MIXED && cards.filter((x) => !x.rated).length === 0
      ? "کارت بی‌امتیاز در این لیست نیست — تست همین ترکیب را می‌سنجد (با REQUIRE_MIXED=0 خاموش می‌شود)"
      : null,
  ].filter(Boolean);

  const sample = cards[0] ?? { w: 0, h: 0 };
  const info = `${cards.length} کارت · ${sample.w}×${sample.h} · امتیاز@${starOffsets[0] ?? "?"} · دکمه@${btnOffsets[0] ?? "?"}` +
    ` · امتیازدار ${cards.filter((x) => x.rated).length}`;
  return { problems, info };
}

async function main() {
  const bin = CANDIDATE_BROWSERS.find((p) => existsSync(p));
  if (!bin) throw new Error("Chrome/Edge پیدا نشد — BROWSER_PATH را ست کن.");

  const profile = mkdtempSync(join(tmpdir(), "gh-card-parity-"));
  const port = 9200 + Math.floor(Math.random() * 400);
  const child = spawn(
    bin,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      // در کانتینر/رانرهای CI سندباکس مرورگر کار نمی‌کند
      ...(process.env.CI ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const failures = [];
  let injectedTotal = 0; // برای خودآزمایی: چند ردیف واقعاً دست‌کاری شد
  try {
    const wsUrl = await pageTargetUrl(port);
    const cdp = await connect(wsUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    // خطاهای سمت صفحه جمع می‌شوند تا هنگام شکست، «چرا» هم دیده شود نه فقط «چه شد»
    let pageErrors = [];
    cdp.on("Runtime.exceptionThrown", (p) => {
      const d = p.exceptionDetails ?? {};
      pageErrors.push(`exception: ${d.exception?.description ?? d.text ?? "?"}`.split("\n")[0].slice(0, 220));
    });
    cdp.on("Runtime.consoleAPICalled", (p) => {
      if (p.type !== "error") return;
      const text = (p.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ");
      if (text) pageErrors.push(`console.error: ${text}`.slice(0, 220));
    });

    for (const c of CASES) {
      pageErrors = [];
      const label = `${c.width}/${c.theme}`;
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: c.width, height: c.height, deviceScaleFactor: 1, mobile: c.width < 768,
      });
      await cdp.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: c.theme }],
      });
      // تمِ سایت از localStorage می‌آید (theme-init) — قبل از لود ست می‌شود
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `try { localStorage.setItem('ghasedak-theme', '${c.theme}'); } catch {}`,
      });

      const loaded = new Promise((res) => cdp.on("Page.loadEventFired", res));
      await cdp.send("Page.navigate", { url: `${BASE}${PATH}` });
      await Promise.race([loaded, sleep(20_000)]);
      for (let i = 0; i < 40; i++) {
        const { result } = await cdp.send("Runtime.evaluate", { expression: "document.querySelectorAll('article').length", returnByValue: true });
        if ((result?.value ?? 0) >= MIN_CARDS) break;
        await sleep(250);
      }

      if (INJECT_REGRESSION_MODE) {
        // hydration ممکن است بعد از load اجرا شود و DOM را به حالت اول برگرداند؛
        // پس تزریق بعد از کمی مهلت دوباره اعمال می‌شود و تعداد اعمال گزارش می‌شود.
        await cdp.send("Runtime.evaluate", { expression: INJECT_REGRESSION, returnByValue: true });
        await sleep(500);
        const { result: inj } = await cdp.send("Runtime.evaluate", { expression: INJECT_REGRESSION, returnByValue: true });
        injectedTotal += inj?.value ?? 0;
      }

      const { result } = await cdp.send("Runtime.evaluate", { expression: MEASURE, returnByValue: true });
      const m = result.value;

      if (SHOTS) {
        const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
        mkdirSync(".visual", { recursive: true });
        writeFileSync(join(".visual", `${label.replace("/", "-")}.png`), Buffer.from(shot.data, "base64"));
      }

      const { problems, info } = checkCase(c, m);
      if (problems.length === 0) console.log(`PASS  ${label.padEnd(11)} ${info}`);
      else {
        console.log(`FAIL  ${label.padEnd(11)} ${info}`);
        for (const p of problems) console.log(`      — ${p}`);
        // زمینهٔ صفحه هنگام شکست — بدون این، «۰ کارت» بین «صفحهٔ خالی» و «سلکتور عوض‌شده» فرقی نمی‌گذارد
        console.log(
          `      … صفحه: ${m.url ?? "?"} · readyState=${m.readyState ?? "?"} · html=${m.htmlLen ?? "?"} بایت` +
            ` · عنوان=«${m.title ?? ""}» · متن=«${m.bodyText ?? ""}»`,
        );
        for (const e of pageErrors.slice(0, 3)) console.log(`      … ${e}`);
        // کلاس خطای رایج و درمانش — بدون این، «۰ کارت» ساعت‌ها وقت می‌گیرد
        if (pageErrors.some((e) => /ChunkLoadError|Loading chunk/.test(e))) {
          console.log(
            "      … راهنما: بیلد عوض شده ولی سرور روی بیلد قدیمی است — سرور را ری‌استارت کن (build → start → تست).",
          );
        }
        if (/چیزی در صفحه از کار افتاد|Application error/i.test(m.bodyText ?? "")) {
          console.log("      … راهنما: صفحه به error-boundary افتاده — استثنای کلاینت را بالا ببین.");
        }
        failures.push(`${label}: ${problems.join(" | ")}`);
      }
    }

    cdp.close();
  } finally {
    child.kill();
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }

  if (SELFTEST) {
    // در حالت خودآزمایی، «گرفتن باگ» موفقیت است و «سبز ماندن» شکست.
    if (failures.length) {
      console.log(
        `\nSELFTEST OK — آشکارساز ناهم‌ترازی را گرفت (${failures.length} حالت؛ تزریق اعمال‌شده روی ${injectedTotal} ردیف).`,
      );
      process.exit(0);
    }
    console.error("\nSELFTEST FAILED — با وجود تزریق باگ، همهٔ حالت‌ها سبز ماندند؛ آشکارساز کار نمی‌کند.");
    process.exit(1);
  }

  if (failures.length) {
    console.error(`\nFAIL — ناهم‌ترازی کارت‌ها در ${failures.length} حالت:\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log(`\nPASS — هندسهٔ کارت‌ها در هر ${CASES.length} حالت (${BASE}${PATH}) یکدست است.`);
}

main().catch((e) => {
  console.error(`FAIL — اجرا نشد: ${e.message}`);
  process.exit(1);
});
