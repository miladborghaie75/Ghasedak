/**
 * اندازه‌گیری p95 پاسخ API (گام ۲۱ — کارایی).
 *
 * اجرا:
 *   node scripts/api-perf.mjs                      # علیه http://localhost:4000
 *   BASE_URL=http://127.0.0.1:4000 N=200 node scripts/api-perf.mjs
 *
 * فقط GETهای فقط-خواندنی داغ فروشگاه اندازه گرفته می‌شوند؛ بودجهٔ بخش ۳ برنامه:
 * p95 زیر ۳۰۰ms.
 */
const base = (process.env.BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
const N = Number(process.env.N ?? 120);

const ENDPOINTS = [
  "GET /api/v1/health",
  "GET /api/v1/catalog/products?per_page=20&page=1",
  "GET /api/v1/catalog/categories",
];

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

for (const ep of ENDPOINTS) {
  const [method, path] = ep.split(" ");
  const times = [];
  let errors = 0;
  // گرم‌کردن (کش سرور/DB) — در اندازه‌گیری حساب نمی‌شود
  for (let i = 0; i < 5; i++) await fetch(base + path, { method });
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    const r = await fetch(base + path, { method });
    await r.arrayBuffer();
    times.push(performance.now() - t0);
    if (!r.ok) errors++;
  }
  times.sort((a, b) => a - b);
  const fmt = (n) => Math.round(n);
  console.log(
    `${method} ${path}\n  n=${N} err=${errors}  p50=${fmt(pct(times, 50))}ms  p95=${fmt(pct(times, 95))}ms  p99=${fmt(pct(times, 99))}ms  max=${fmt(times[times.length - 1])}ms`,
  );
}
