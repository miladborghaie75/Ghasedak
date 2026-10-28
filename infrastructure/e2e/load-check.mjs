#!/usr/bin/env node
/**
 * گام ۳۱ (F3-7) — کارایی/بار؛ اسکریپت سبک به‌جای k6 (بدون وابستگی جدید).
 * استفاده: node load-check.mjs [DURATION_SEC=30] [CONCURRENCY=30]
 * هدف بخش ۳: API p95 < 300ms. صفحات SSR فروشگاه سقف sanity داخلی ۸۰۰ms دارند
 * (هدف رسمیِ LCP در Lighthouse است که جداگانه در perf-report ثبت شده).
 */
const DURATION = Number(process.argv[2] ?? 30) * 1000;
const CONCURRENCY = Number(process.argv[3] ?? 30);
const STORE = process.env.STORE_BASE ?? "http://127.0.0.1:3000";
const API = process.env.API_BASE ?? "http://127.0.0.1:4000";

const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))];

async function discoverPaths() {
  const paths = new Set(["/", "/search?q=سوتین", "/need", "/about"]);
  try {
    const xml = await (await fetch(`${STORE}/sitemap.xml`)).text();
    for (const m of xml.matchAll(/<loc>[^<]+\/([^<]*)<\/loc>/g)) {
      const p = "/" + m[1];
      if (!paths.has(p) && paths.size < 12) paths.add(p);
    }
  } catch { /* sitemap اختیاری */ }
  return [...paths];
}

async function time(url) {
  const t0 = performance.now();
  try {
    const r = await fetch(url, { redirect: "manual" });
    return { ms: performance.now() - t0, status: r.status };
  } catch {
    return { ms: performance.now() - t0, status: 0 };
  }
}

const paths = await discoverPaths();
const targets = paths.map((p) => ({ name: `store${p === "/" ? "/" : p}`, url: STORE + p }));
targets.push({ name: "api/health", url: `${API}/api/v1/health` });
targets.push({ name: "api/coupon-quote", url: `${API}/api/v1/orders/quote/coupon?code=NOPE&subtotal=1000` });

log(`بار: ${DURATION / 1000}s × ${CONCURRENCY} VU روی ${targets.length} مسیر:`);
targets.forEach((t) => log("  -", t.name));

await Promise.all(targets.map((t) => time(t.url))); // warm-up (JIT/کش اولیه)

const lat = new Map(targets.map((t) => [t.name, []]));
let req = 0, errs = 0;
const tEnd = Date.now() + DURATION;

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (Date.now() < tEnd) {
      const t = targets[req % targets.length]; req++;
      const r = await time(t.url);
      lat.get(t.name).push(r.ms);
      if (r.status >= 400 || r.status === 0) errs++;
    }
  }),
);

const all = [...lat.values()].flat().sort((a, b) => a - b);
log(`کل: ${req} درخواست، ${errs} خطا (${((errs / req) * 100).toFixed(1)}%)، ${Math.round(req / (DURATION / 1000))} req/s`);
let apiFail = 0;
for (const [name, arr] of lat) {
  const s = [...arr].sort((a, b) => a - b);
  const p50 = Math.round(pct(s, 50)), p95 = Math.round(pct(s, 95)), p99 = Math.round(pct(s, 99));
  const gate = name.startsWith("api/") ? 300 : 800;
  const isFail = p95 > gate;
  if (isFail && name.startsWith("api/")) apiFail++;
  log(`  ${name}: n=${s.length} p50=${p50}ms p95=${p95}ms p99=${p99}ms ${p95 <= gate ? "✓" : "✗ (>" + gate + "ms)"}`);
}
log(`API p95 کل: ${Math.round(pct([...lat.get("api/health"), ...lat.get("api/coupon-quote")].sort((a, b) => a - b), 95))}ms (هدف < ۳۰۰ms)`);
log(apiFail === 0 ? "LOAD_CHECK_PASSED ✅" : "LOAD_CHECK_FAILED ❌");
process.exit(apiFail === 0 ? 0 : 1);
