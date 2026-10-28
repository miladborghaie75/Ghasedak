# گزارش کارایی — گام ۲۱ (F1-8) — ۲۰۲۶-۱۰-۲۷

> ابزار: Lighthouse (mobile، شبیه‌سازی 4G/CPU 4×) روی `next start` محلی، `scripts/api-perf.mjs`،
> `prisma migrate diff` + `EXPLAIN`. خروجی‌های خام: `docs/perf-before*.json`، `docs/perf-after*.json`.
>
> ⚠️ **روش‌شناسی:** این ماشین (Windows + OneDrive) نویز لابراتواری زیادی دارد؛ اجرای‌های پشت‌سرهم
> از **یک بیلد** هم نمرهٔ ۴۶ تا ۸۵ گرفتند (قبل: home ‏۴۶/۵۹/۶۰، دسته ‏۶۱/۷۸/۸۵). جدول زیر میانهٔ
> چند اجرا در هر سمت است؛ فقط تفاوت‌هایی «بهبود» قلمداد شدند که دامنهٔ دو سمت هم‌پوشانی ندارد.

## ۱. جدول قبل/بعد (میانهٔ اجراها)

| صفحه | معیار | قبل | بعد | تغییر |
|---|---|---|---|---|
| **/** (خانه) | امتیاز Lighthouse | ۵۹ (۴۶–۶۰) | **۷۵ (۷۲–۷۸)** | **+۱۶** — بدون هم‌پوشانی دامنه |
| **/** | LCP | ۴۵۳۱ms | **۳۴۱۴ms** | **−۲۵٪** |
| **/** | TBT (نمای INP) | ۱۰۹۱ms | **۵۷۸ms** | **−۴۷٪** |
| **/** | Speed Index | ۴۹۲۴ms | **۲۵۷۴ms** | **−۴۸٪** |
| **/** | CLS | ۰٫۰۰۴ | ۰٫۰۰۱ | ✓ (بودجه <۰٫۱) |
| **/p/[slug]** | امتیاز | ۶۳ | ۶۴ | ≈ صاف (درون نویز) |
| **/c/[slug]** | امتیاز | ۷۸ (۶۱–۸۵) | ۶۹ (۶۶–۷۵) | دامنه‌ها هم‌پوشانی — قضاوت قطعی ناممکن |
| **/checkout** | First Load JS | 151 kB | **104 kB** | **−۴۷ kB (−۳۱٪)** — از بودجه رد شد ✅ |

## ۲. حداقل ۳ بهبود (شواهد قطعی، مستقل از نویز لاب)

1. **باندل چک‌اوت:** `next build` قبل/بعد: `/checkout` ‏151 → **104 kB** gzip؛ فرم checkout با
   `next/dynamic` در wrapper کلاینت (`CheckoutClientLazy`) از بار اولیه خارج شد (اسکلت با
   `min-h-96` تا CLS صفر بماند).
2. **باندل چت در مسیر بحرانی:** کد چت‌بات (شامل `ai-client`/`chat-history`) اکنون فقط در چانک
   تنبل جداگانه `4633` (‎22.3 kB‎) است و در **۱۶ اسکریپت اولیهٔ HTML خانه حضور ندارد**
   (اندازه‌گیری روی HTML سرو‌شده)؛ با `ChatWidgetLazy` بعد از hydration بارگذاری می‌شود.
3. **ایندکس‌های داغ DB + رفع drift:** مهاجرت `20261026150000_step21_perf_hot_indexes`
   (۴ ایندکس + FK PayrollItem + پیش‌فرض‌های updatedAt + تضمین enum)؛ `EXPLAIN` قبل/بعد:
   کاتالوگ `Seq Scan` → `Bitmap Index Scan on Product_status_createdAt_idx`؛ فهرست سفارش‌ها
   → `Index Scan Backward on Order_status_createdAt_idx` (مرتب‌سازی حذف شد).
   سه‌طرفه صفر شد: `migrate diff` از `url→schema` و `migrations→schema` هر دو
   **No difference detected** و `migrate status` سبز.
4. **p95 API (بودجهٔ <۳۰۰ms):** `scripts/api-perf.mjs` روی API زنده (n=120 هر مسیر):
   health p95=**14ms** · catalog/products p95=**32ms** · categories p95=**12ms** — همگی زیر یک‌دهم بودجه.
5. **TTFB سریال→موازی:** ۴ خواندن سریالی layout (catalog/theme/motion/maintenance) موازی شدند
   (۳ سفر هم‌زمان؛ `fetch` مردهٔ motion هم حذف شد چون خروجی‌اش در JSX استفاده نمی‌شد).
   تک‌نمونهٔ cold TTFB محلی قطعی نشد (۰٫۳۴s قبل / ۰٫۵۲s بعد — I/O همزمان OneDrive)؛ سود تولیدی
   = ۳ RTT شبکهٔ API در هر رندر سرد است.

## ۳. وضعیت بودجه‌های بخش ۳

| بودجه | هدف | وضعیت |
|---|---|---|
| CLS | < 0.1 | ✅ همهٔ صفحات ≤ 0.004 |
| API p95 | < 300ms | ✅ بدترین مقدار 32ms |
| Bundle (shared) | ≤ 150 kB | ✅ shared = 102 kB؛ `/checkout` = 104 kB |
| LCP (موبایل 4G) | < 2.5s | ❌ میانهٔ خانه 3.3s — **باز** (نیازمند بهبودهای تصویر/LCP-priority عمیق‌تر) |
| INP (نمای لاب: TBT) | < 200ms | ❌ میانهٔ خانه 498ms — **باز** |
| Routes ≤ 150 kB | همهٔ مسیرها | ❌ `/p` ‏174 · خانه/دسته 167 · سبد 165 — **باز** (کاندید: تنبل‌سازی QuickAddHost/MotionReveal، حذف وابستگی‌های Header/Footer از بار اول) |

## ۴. آنچه از قبل بررسی و تأیید شد (بدون تغییر لازم)

- **تصاویر:** همه از `next/image` با `sizes` (صفر `<img>` خام) در کد فروشگاه.
- **فونت:** Vazirmatn variable از `@fontsource-variable` (subset لاتین/عربی-فارسی، `font-display` پیش‌فرض swap).
- **کش:** TTL ماژول‌سطح کاتالوگ + `next: { revalidate }` برای برندها/دسته‌ها + `no-store` عمداً
  برای صفحات CMS/تم/تعمیر (تضمین تازگی — مستند در همان فایل‌ها).

## ۵. فایل‌های شاهد

- `docs/perf-before-home.json`، `docs/perf-before2-*-run{1,2}.json` (قبل، چند اجرا)
- `docs/perf-after-home.json`، `docs/perf-after-c-bra-run{1,2,3}.json` (بعد، چند اجرا)
- `docs/evidence/build-before.log` / `docs/evidence/build-after.log` (جدول مسیرهای build)
- `docs/evidence/test-suite.log` (۵۳۷ تست API پس از مهاجرت DB — ۶۴/۶۴ سبز)
- `docs/a11y-*.json` (قبل/بعد — شامل ادمین و تم تاریک axe از طریق مرورگر زنده)
- `scripts/api-perf.mjs` (قابل تکرار برای مانیتورینگ p95 — گام ۲۳)

## ۶. موارد باز (پیشنهاد برای بعد)

1. LCP/TBT زیر بودجه: تصویر LCP با `priority` صریح + کاهش eval چانک‌های framework (خارج از scope این گام).
2. مسیرهای >150kB: لیست کاندیداهای lazy در بند ۳.
3. نویز لاب را با اجرای اندازه‌گیری‌ها روی لینوکس/CI (بدون OneDrive) برای اعداد قطعی تر تکرار شود.
