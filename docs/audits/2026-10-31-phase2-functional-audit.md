# ممیزی فاز ۲ — تست عملکردی، رفع باگ و شاهد خام

- تاریخ: ۲۰۲۶-۱۰-۳۱
- برنچ: `audit-and-optimization`
- دامنه: API، فروشگاه، پنل ادمین، محیط ایزولهٔ تست
- نسخهٔ تولید در زمان تست: **دست‌نخورده**؛ سپس با تأیید صریح کاربر مستقر شد (بخش ۹)

---

## ۱) محیط تست ایزوله

| مورد | مقدار |
|---|---|
| دیتابیس | `ghasedak_audit` روی PostgreSQL همان VPS (پورت داخلی ۵۴۳۲) |
| API تست | `dist-audit` روی پورت **۴۰۱۱**، `NODE_ENV=development`، کاربر `ghasedak` |
| پرداخت | provider `mock` (بدون درگاه واقعی) |
| پیامک/هوش مصنوعی | غیرفعال (`audit-disabled`) تا هیچ هزینه/پیام واقعی ایجاد نشود |
| فروشگاه تست | Next dev روی `127.0.0.1:3311` با `API_ORIGIN=127.0.0.1:4011` |
| تولید | سرویس‌های ۴۰۰۰/۳۱۱۱/۳۲۰۰ و دیتابیس `ghasedak` بدون تغییر |

نکتهٔ امنیتی: پورت‌های ۴۰۰۰/۴۰۱۰/۳۱۱۱/۳۲۰۰ روی VPS با `ufw` از بیرون بسته‌اند و فقط از خود سرور قابل دسترسی‌اند (بررسی‌شده با curl خارجی: همه timeout).

---

## ۲) هارنس تست مستقل

مسیر: `audit/`

- `audit/lib/http.mjs` — کلاینت HTTP با cookie jar (برای تست نشست و CSRF)
- `audit/lib/runner.mjs` — اجراکننده/گزارش‌گیر سبک
- `audit/api/01-public.test.mjs` — کاتالوگ، جستجو، سلامت، روش‌های ارسال/پرداخت
- `audit/api/02-order-payment.test.mjs` — سبد، تسویهٔ مهمان، idempotency، پرداخت mock، callback، verify
- `audit/api/03-auth.test.mjs` — ورود/خروج ادمین، کوکی HttpOnly، کنترل دسترسی
- `audit/api/04-security.test.mjs` — CSRF، ۴۰۴ دادهٔ سفارش، مسیرهای ادمین، rate limit
- گزارش خام: `audit/reports/latest.json`

اجرا:

```bash
AUDIT_API_BASE=http://127.0.0.1:4011/api/v1 node audit/run.mjs
```

نتیجهٔ نهایی: **۳۲ موفق / ۰ ناموفق از ۳۲**.

تست‌های خود پروژه هم اجرا شدند (نه به‌عنوان تنها ملاک):

| مجموعه | نتیجه |
|---|---|
| تست‌های فروشگاه (`pnpm --filter @ghasedak/storefront test`) | موفق (خروج ۰) |
| تست‌های پنل (`pnpm --filter @ghasedak/admin test`) | موفق (خروج ۰) |
| تست چت عمومی (۶ تست) | ۶/۶ |
| تایپ‌چک API / فروشگاه / پنل | هر سه موفق |
| بیلد API | موفق |

---

## ۳) تست E2E خرید واقعی (مرورگر)

مسیر کامل روی محیط ایزوله طی شد:

1. صفحهٔ اصلی → صفحهٔ محصول `sootin-classic-demo`
2. افزودن به سبد → سبد (`/cart`)
3. تسویهٔ مهمان (`/checkout`) با استان/شهر تهران از دیتابیس geo
4. ثبت سفارش → **ORD-000012** با مبلغ **۷۹۸٬۰۰۰ تومان** (قیمت و ارسال سمت سرور)
5. شروع پرداخت mock → صفحهٔ «درگاه آزمایشی»
6. «پرداخت موفق (تست)» → صفحهٔ «پرداخت موفق»
7. تأیید سمت سرور: `paymentStatus = PAID`، `status = PAID`، کد پیگیری `MOCKRF-l7sic3vf`

بررسی ۴۰۴:

| مسیر | کد |
|---|---|
| `/this-page-does-not-exist-xyz` | ۴۰۴ |
| `/p/no-such-product-xyz` | ۴۰۴ |
| `/c/no-such-category` | ۴۰۴ |
| `/account/orders/NO-SUCH` | ۳۰۷ (ریدایرکت ورود — درست) |

کرال لینک‌های صفحهٔ اصلی روی تولید: **۳۰ لینک، همه ۲۰۰/۳۰۷** (هیچ لینک شکسته‌ای در ناوبری اصلی پیدا نشد).

---

## ۴) باگ‌های تأییدشده و رفع‌شده

### ۴-۱) اسلاگ فارسی با حرکت (`slugifyFa`) — CI قرمز

`سوتّین` و `سوتین` دو اسلاگ متفاوت می‌ساختند چون شدّه (U+0651) داخل بازهٔ مجاز `U+0600–U+06FF` می‌ماند.
اکنون `U+064B–U+065F` و `U+0670` حذف می‌شوند.

- `packages/contracts/src/persian.ts`

تست مربوطه هم `ensureUniqueSlug` را بدون `await` با رشته مقایسه می‌کرد و همیشه قرمز بود؛ اصلاح شد:

- `apps/storefront/lib/persian.test.ts`

### ۴-۲) پرداخت: نبود `idempotencyKey` → ۵۰۰

`findUnique({ where: { idempotencyKey: undefined } })` در Prisma خطا می‌داد.
اکنون کلید سمت سرور ساخته می‌شود و نبودِ `orderId` هم ۴۰۰ صریح می‌دهد (نه ۵۰۰).

- `apps/api/src/payments/payments.controller.ts`
- تست: `audit/api/02-order-payment.test.mjs`

### ۴-۳) سفارش ناموجود: ۲۰۰ با بدنهٔ null

`GET /orders/by-code/:code` برای کد ناموجود ۲۰۰ می‌داد؛ اکنون ۴۰۴ صریح است.

- `apps/api/src/orders/orders.controller.ts`

### ۴-۴) سقوط کل API هنگام قطع موقت دیتابیس (P1)

`setInterval(() => void this.drain(), …)` بدون `catch` بود. با قطع/restart دیتابیس، rejection مدیریت‌نشده روی Node 26 **فرایند API را می‌کشت**. در همین ممیزی یک بار رخ داد و در لاگ ثبت شد (`P1001` در `webhooks.service`).

هر هفت تایمر پس‌زمینه اکنون `.catch(...)` با لاگ دارند:

- `apps/api/src/events/webhooks.service.ts`
- `apps/api/src/events/event-bus.service.ts`
- `apps/api/src/events/notification-dispatcher.service.ts`
- `apps/api/src/checks/reminder.service.ts`
- `apps/api/src/accounting/cogs-backfill.service.ts`
- `apps/api/src/admin/data-health.service.ts`
- `apps/api/src/monitoring/health-watch.service.ts`

### ۴-۵) rate-limit: سطل مشترک ۱۲۷.۰.۰.۱ و XFF قابل جعل (P1 امنیتی/دسترس‌پذیری)

فروشگاه و پنل، درخواست‌ها را سمت‌سرور به API می‌فرستند؛ بنابراین `req.ip` در API برای همهٔ مشتری‌ها `127.0.0.1` بود:

- ۵ ورود ناموفق در دقیقه = قفل شدن پنل برای همه (DoS ساده)
- سقف ۱۰ سفارش در دقیقه = سراسری، نه per-user

از طرف دیگر چت عمومی اولین مقدار `x-forwarded-for` را می‌خواند که کلاینت می‌تواند جعل کند (دور زدن سقف چتِ هزینه‌دار).

رفع:

- `apps/storefront/lib/client-ip.ts` — آخرین hop (مقداری که nginx اضافه می‌کند) به‌عنوان IP واقعی
- `apps/storefront/app/api/checkout/route.ts`، `pay/start/route.ts`، `reviews/route.ts`، `ai/chat/route.ts`
- `apps/api/src/common/rate-limit.middleware.ts` — اگر اتصال از loopback باشد، آخرین XFF معتبر است (بدون نیاز به تنظیم env)
- `apps/admin/lib/upstream.ts` و `apps/admin/app/login/page.tsx` — ارسال IP واقعی برای ورود ادمین

شاهد: با دو XFF متفاوت روی `/auth/login` پاسخ‌ها ۴۰۱ (نه ۴۲۹) شدند — یعنی سطل‌ها جدا شدند.

### ۴-۶) نمایش محورهای خالی و برچسب «— · سایز —» (UX)

محصولی که رنگ/سایز به واریانتش وصل نیست، دو فیلدست خالی «رنگ» و «سایز» نشان می‌داد و در سبد «— · سایز —» می‌آمد؛ مشتری فکر می‌کند انتخاب‌ها لود نشده‌اند.

- `apps/storefront/lib/variant-axes.ts` — محور بدون ترم ساخته نمی‌شود
- `apps/storefront/components/commerce/CartClient.tsx` — بخش‌های نامشخص حذف و در نبود هر دو، «بدون تنوع»

---

## ۵) کارایی (اندازه‌گیری‌شده)

### API روی خود VPS (localhost، بدون شبکهٔ بیرونی)

| مسیر | TTFB |
|---|---|
| `/catalog/products?per_page=12` | ۸۶ms |
| `/catalog/categories` | ۱۹ms |
| `/shipping/methods` | ۱۴ms |
| `/payments/methods` | ۲۴ms |
| `/need-finder/steps` | ۱۲ms |

### صفحات تولید (curl از localhost:3111، ۳–۵ اجرا)

| صفحه | TTFB | حجم HTML |
|---|---|---|
| `/` | ۱۲۰–۲۹۰ms | ۳۵KB |
| `/p/sootin-classic-demo` | ۱۱۸–۲۰۰ms | ۲۰KB |
| `/checkout` | ۶۰–۱۰۰ms | ۱۲KB |
| `/cart` | ۴۴–۶۲ms | ۱۳KB |
| `/contact` | ۸۸–۱۶۴ms | ۱۶KB |

### از بیرون (همین شبکه)

`https://lebaszirghasedak.ir/` → ۳۰۱ به `www` و سپس ۲۰۰؛ مجموع ۱٫۸–۴٫۳ ثانیه.
بخشی از این عدد فاصلهٔ شبکه است، اما ریدایرکت اجباری `non-www → www` یک round-trip اضافه می‌کند. انتخاب یک دامنهٔ کانونیکال و ریدایرکت ۳۰۸/۳۰۱ در لبه، یا حذف ریدایرکت، توصیه می‌شود.

---

## ۶) یافته‌های باقی‌مانده (بدون رفع در این فاز)

### P0 — پیش از بهره‌برداری تجاری

1. **کاتالوگ تولید فقط یک محصول DEMO دارد**: `sootin-classic-demo` («سوتین کلاسیک (DEMO)») و **بدون تصویر**. برای فروش واقعی باید محصولات، واریانت‌ها (رنگ/سایز)، موجودی و عکس‌ها از پنل وارد شوند. این تنها مانع بزرگ «آماده فروش بودن» است.

### P1 — نیازمند تأیید/استقرار

2. اصلاحات این برنچ هنوز روی تولید نیست؛ برای فعال شدن باید API/فروشگاه/پنل بیلد و ری‌استارت شوند (بدون مهاجرت دیتابیس).
3. `PAYMENT_CALLBACK_ORIGINS` تولید باید هر دو دامنهٔ کانونیکال (با/بدون www) را داشته باشد؛ وگرنه شروع پرداخت با پیام «آدرس بازگشت خارج از دامنه‌های مجاز» رد می‌شود. (در محیط تست همین مورد رخ داد و اصلاح env حلش کرد.)

### تست‌نشده (نیازمند سرویس/دسترسی بیرونی)

4. پرداخت واقعی زرین‌پال (نیازمند Merchant ID و Sandbox) — فقط mock تست شد.
5. ارسال واقعی پیامک OTP/سفارش (کاوه‌نگار/SMS.ir) — عمداً غیرفعال بود.
6. پاسخ واقعی هوش مصنوعی (کلید AI) — عمداً غیرفعال بود؛ فقط مسیر خطا/سقف تست شد.
7. بکاپ/بازیابی دیتابیس، مانیتورینگ و هشدارها (Alerting/Sentry) در عمل تست نشد.
8. تست بین‌مرورگری/دستگاه واقعی و بازبینی بصری (visual regression) انجام نشد؛ فقط DOM و a11y tree در Chromium بررسی شد.
9. پنل ادمین فقط از سمت API (ورود/دسترسی) تست شد؛ سناریوهای CRUD پنل به‌صورت E2E خودکار پوشش داده نشد. (در تست دستی دامنهٔ محصول/سفارش، فرم‌ها سالم بودند.)

---

## ۷) توصیهٔ استقرار (پس از تأیید صریح)

1. بکاپ دیتابیس تولید.
2. بیلد و ری‌استارت `ghasedak-api`، `ghasedak-storefront`، `ghasedak-admin` از همین برنچ.
3. بررسی `PAYMENT_CALLBACK_ORIGINS` و `CORS_ORIGINS`/`CSRF_ALLOWED_ORIGINS` شامل `https://lebaszirghasedak.ir` و `https://www.lebaszirghasedak.ir`.
4. تست دود: خانه، محصول، افزودن به سبد، شروع پرداخت (بدون پرداخت واقعی)، ورود ادمین، ۴۰۴ مسیر ناموجود.
5. پاک‌سازی محیط ممیزی: `dist-audit`، `/root/start-audit-api.sh`، دیتابیس `ghasedak_audit` (در صورت عدم نیاز به تست‌های بعدی).

---

## ۸) نتیجهٔ استقرار (۲۰۲۶-۱۰-۳۰)

استقرار با `infrastructure/deploy/server/deploy.sh` و `BRANCH=audit-and-optimization` انجام شد.

| مورد | مقدار |
|---|---|
| کامیت مستقرشده | `b52054b` |
| بکاپ دیتابیس | `/var/backups/ghasedak/predeploy-20261030-220311.dump` (۳۴۴KB) |
| بکاپ build قبلی | `/var/backups/ghasedak/build-20261030-220311.tgz` (۵۸MB) |
| بکاپ nginx | `/var/backups/ghasedak/nginx-20261030-220311.conf` |
| سرویس‌ها | api / storefront / admin همه `active`، `NRestarts=0` |

تست دود پس از استقرار:

- `GET /api/v1/health` → ۲۰۰ با `db:true`
- `GET /api/v1/orders/by-code/NOPE-123` → **۴۰۴** (اثبات رفع باگ ۲۰۰/null روی تولید)
- خانه / محصول / سبد / تسویه / لوگوی اینماد → ۲۰۰
- مسیر ناموجود → ۴۰۴؛ ورود پنل → ۲۰۰
- rate-limit per-IP روی تولید: ۶ تلاش از IP-A → `401×5` سپس **۴۲۹**؛ همان لحظه از IP-B → **۴۰۱** (سطل‌ها جدا شدند)
- صفحهٔ محصول DEMO دیگر فیلدست خالی ندارد (`fieldset-count=0`)
- ۵xx در nginx پس از استقرار: **۰**
- هیچ خطای unhandled/error در ژورنال سه سرویس پس از ری‌استارت ثبت نشد

محیط ممیزی (API روی ۴۰۱۱ و فایل‌های موقت آن) پس از استقرار متوقف و پاک شد؛ دیتابیس `ghasedak_audit` برای تست‌های بعدی روی سرور باقی ماند.

---

## ۹) محدودیت‌های این گزارش

- هیچ تغییری روی تولید اعمال نشد؛ همهٔ نتایج از دیتابیس/سرویس ایزوله است.
- اعداد کارایی روی VPS و شبکهٔ فعلی اندازه‌گیری شده؛ ملاک نهایی باید از داخل ایران و با کاربران واقعی سنجیده شود.
- تست‌های خودکار فقط مسیرهای کلیدی را پوشش می‌دهند؛ «۳۲/۳۲ سبز» به‌معنای «بدون باگ» نیست.
