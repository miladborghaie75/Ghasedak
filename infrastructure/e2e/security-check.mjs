#!/usr/bin/env node
/**
 * گام ۳۲ (F3-8) — امنیت OWASP مختصر؛ شواهد اجرایی قابل تکرار.
 * استفاده: node security-check.mjs [API_BASE] [STORE_BASE] [ADMIN_BASE]
 * ترتیب مهم است: rate-limit (آخرین چک) بعد از لاگین‌های واقعی اجرا می‌شود
 * تا پنجرهٔ ۱۰/دقیقه را برای لاگین‌های قانونی مسموم نکند.
 */
const API = (process.argv[2] ?? "http://127.0.0.1:4000") + "/api/v1";
const STORE = process.argv[3] ?? "http://127.0.0.1:3000";
const ADMIN = process.argv[4] ?? "http://127.0.0.1:3200";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@ghasedak.demo";
const ADMIN_PASS = process.env.E2E_ADMIN_PASS ?? "Ghasedak#Demo1";
const ORDER_CODE = process.env.E2E_ORDER_CODE ?? "ORD-000018";

const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
let failed = 0;
const ok = (m) => log("  ✓", m);
const bad = (m) => { failed++; log("  ✗ FAIL:", m); };

log("== گام ۳۲ — امنیت OWASP مختصر ==");

// ── ۱) سرفصل‌های امنیتی ────────────────────────────────────────────
log("۱) سرفصل‌های امنیتی (helmet در API؛ headers() در Nextها):");
for (const [name, base, path] of [["API", API, "/health"], ["Storefront", STORE, "/"], ["Admin", ADMIN, "/login"]]) {
  const r = await fetch(base + path, { redirect: "manual" }).catch(() => null);
  if (!r) { bad(`${name} در دسترس نیست (${base}${path})`); continue; }
  for (const h of ["x-content-type-options", "referrer-policy"]) {
    (r.headers.get(h) ? ok : bad)(`${name}: ${h} = ${r.headers.get(h) ?? " MISSING"}`);
  }
  // محافظت clickjacking: API/ادمین X-Frame-Options؛ فروشگاه CSP frame-ancestors
  // (با فهرست مجازِ پنل — SAMEORIGIN پیش‌نمایش زندهٔ صفحه‌ساز را می‌شکست؛ گام ۲۸)
  const csp = r.headers.get("content-security-policy") ?? "";
  const xfo = r.headers.get("x-frame-options");
  const guarded = xfo !== null || /frame-ancestors/.test(csp);
  (guarded ? ok : bad)(`${name}: clickjacking = ${xfo ? `XFO ${xfo}` : csp ? `CSP ${csp}` : " MISSING"}`);
}

// ── ۲) دسترسی بدون احراز → 401 (نه 500 و نه نشت داده) ─────────────
log("۲) بدون احراز هویت:");
const unauth = await fetch(`${API}/orders`).catch(() => null);
(unauth?.status === 401 ? ok : bad)(`GET /orders بدون سشن → ${unauth?.status} (انتظار 401)`);

// ── ۳) IDOR نمونه‌ای: سفارش با کد — عمومی بدون PII، ادمین کامل ─────
log(`۳) IDOR: by-code/${ORDER_CODE}`);
const pub = await fetch(`${API}/orders/by-code/${ORDER_CODE}`).then((r) => r.json()).catch(() => null);
if (!pub) bad("پاسخ عمومی سفارش نگرفته شد");
else {
  const leaked = ["guestName", "guestMobile", "address", "mobile", "phone"].filter((k) => JSON.stringify(pub).includes(`"${k}":"`));
  (leaked.length === 0 ? ok : bad)(`نمای عمومی بدون PII (لو رفته: ${leaked.join(",") || "هیچ"})`);
}

// ── ۴) لاگین ادمین + پرچم‌های کوکی سشن ─────────────────────────────
log("۴) لاگین ادمین (برای چک‌های سطح دسترسی):");
const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
});
if (login.status !== 200) { bad(`لاگین ادمین → ${login.status}`); }
else {
  const setCookie = login.headers.get("set-cookie") ?? "";
  (/httponly/i.test(setCookie) ? ok : bad)("کوکی سشن httpOnly");
  (/samesite=lax/i.test(setCookie) ? ok : bad)("کوکی سشن SameSite=Lax");
  // Secure فقط در production (auth.controller) — در dev بدون HTTPS نباید باشد وگرنه کوکی اصلاً ذخیره نمی‌شود
  (/\bsecure\b/i.test(setCookie) ? bad : ok)("کوکی Secure در dev خاموش (در prod باید روشن باشد — چک staging)");
  const cookie = setCookie.split(";")[0];
  const full = await fetch(`${API}/orders/by-code/${ORDER_CODE}`, { headers: { cookie } }).then((r) => r.json()).catch(() => null);
  const fullStr = JSON.stringify(full ?? {});
  (/guestMobile|address/.test(fullStr) ? ok : bad)("نمای ادمین by-code کامل است (PII مجاز برای orders.view)");

  // ── ۵) CSRF: مینت مالی بدون توکن → 403 ───────────────────────────
  log("۵) CSRF روی اکشن مالی:");
  const orderId = full?.id ?? full?.order?.id;
  if (!orderId) bad("شناسهٔ سفارش برای چک CSRF پیدا نشد");
  else {
    // گارد باید درخواستِ cross-site را رد کند: Origin غیرمجاز + بدون توکن double-submit
    const csrf = await fetch(`${API}/orders/${orderId}/cancel`, {
      method: "POST",
      headers: { cookie, origin: "https://evil.example" }, // بدون x-csrf-token
      redirect: "manual",
    }).catch(() => null);
    (csrf?.status === 403 ? ok : bad)(`POST cancel با Origin غیرمجاز → ${csrf?.status} (انتظار 403)`);
    // بدون هدر Origin/Referer = فراخوانی سمت‌سرور → مجاز (کوکی قربانی همراه نیست)
    const serverish = await fetch(`${API}/orders/${orderId}/cancel`, {
      method: "POST",
      headers: { cookie },
      redirect: "manual",
    }).catch(() => null);
    (serverish?.status !== 403 ? ok : bad)(`POST cancel بدون Origin (سمت‌سرور) → ${serverish?.status} (انتظار: غیر-403)`);
  }

  // ── ۶) RBAC نمونه‌ای: ادمین مجاز ولی نقش پایین‌تر باید 403 بگیرد ─
  log("۶) RBAC: نقش بی‌اجازه:");
  const cashierLogin = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "cashier@ghasedak.demo", password: ADMIN_PASS }),
  });
  if (cashierLogin.status !== 200) bad(`لاگین صندوقدار → ${cashierLogin.status}`);
  else {
    const cCookie = (cashierLogin.headers.get("set-cookie") ?? "").split(";")[0];
    const rbac = await fetch(`${API}/admin/accounting/trial-balance`, { headers: { cookie: cCookie } }).catch(() => null);
    ([401, 403].includes(rbac?.status) ? ok : bad)(`صندوقدار → گزارش حسابداری: ${rbac?.status} (انتظار 401/403)`);
  }
}

// ── ۷) Rate-limit لاگین: ۱۰ خطا/دقیقه سپس 429 (آخر تا سشن واقعی مسموم نشود) ──
log("۷) Rate-limit لاگین (۱۰/دقیقه):");
let got429 = -1;
for (let i = 1; i <= 12; i++) {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "nonexistent@ghasedak.demo", password: "wrong" }),
  }).catch(() => null);
  if (r?.status === 429) { got429 = i; break; }
}
(got429 > 0 ? ok : bad)(`اولین 429 روی تلاش شمارهٔ ${got429} (انتظار: ۱۱ام — سقف ۱۰)`);

log(failed === 0 ? "SECURITY_CHECK_PASSED ✅" : `SECURITY_CHECK_FAILED ❌ (${failed} مورد)`);
process.exit(failed === 0 ? 0 : 1);
