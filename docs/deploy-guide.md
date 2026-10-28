# راهنمای استقرار قاصدک روی هاست (docs/deploy-guide.md)

> هدف: بالا آوردن کامل پشتهٔ فروشگاه قاصدک روی یک سرور ویندوزی (یا هر هاستی که Node اجرا می‌کند) با دادهٔ واقعی، بکاپ زمان‌بندی‌شده و درگاه/پیامک واقعی. این راهنما از وضعیت واقعی همین ریپو نوشته شده — نه الگوی کلی.

## ۱. پیش‌نیازها

| ابزار | نسخهٔ آزموده‌شده | توضیح |
|---|---|---|
| Node.js | 22 LTS | برای API و هر دو اپ Next |
| pnpm | 9+ | مدیر بستهٔ ریپو (`corepack enable`) |
| PostgreSQL | 15+ | فقط سرور DB؛ نیازی به نصب محلی ندارد |
| ابزار بکاپ | `C:/ghasedak-tools/pg-client` | `pg` + `pg-copy-streams` خارج از ریپو (پیش‌نیاز اسکریپت بکاپ) |

## ۲. معماری پشته (چه چیزی روی چه پورتی)

| سرویس | پورت پیش‌فرض | دستور اجرا | متغیرهای کلیدی |
|---|---|---|---|
| API (NestJS) | 4000 | `npm run start` در `apps/api` (`node dist/main.js`) | `DATABASE_URL`, `PORT`, `CORS_ORIGINS`, `GHASEDAK_WORKERS=off` برای اجرای چندپروسه‌ای |
| فروشگاه (storefront) | 3111 (یا 3000) | `npx next start -p 3111` در `apps/storefront` | `API_ORIGIN=http://127.0.0.1:4000` |
| پنل ادمین (admin) | 3200 (یا 3001) | `npx next start -p 3200` در `apps/admin` | rewrite `/api` → API مرکزی |

- API همهٔ مسیرها را زیر `api/v1` سرو می‌کند (`app.setGlobalPrefix`).
- `.env.local` کنار `apps/api` (نوشتهٔ پنل ادمین) **قبل از بوت** خوانده می‌شود؛ env سیستم همیشه اولویت دارد.
- هر دو اپ Next با `API_ORIGIN` به API وصل‌اند؛ ادمین و storefront هیچ‌گاه مستقیم DB نمی‌خوانند.

## ۳. گام‌های استقرار

### ۳.۱ کد و بسته‌ها
```bash
git clone <repo> && cd ghasedak
pnpm install
```

### ۳.۲ متغیرهای محیطی
از `.env.example` ریشه الگو بگیرید. حداقلِ production:

```ini
NODE_ENV=production
TZ=Asia/Tehran
# روی سرور، همان پورت/سوکت سرویس postgres خود سرور (معمولاً 5432 — این «پورت dev» نیست).
DATABASE_URL=postgresql://USER:PASS@127.0.0.1:5432/ghasedak
PORT=4000                     # هشدار F0-4: PORT=0 در Node یعنی پورت تصادفی — هرگز ۰ نگذارید
CORS_ORIGINS=https://shop.example.com,https://admin.example.com
PAYMENT_CALLBACK_ORIGINS=https://shop.example.com   # گام F0-5 — بدون این، پرداخت آغاز نمی‌شود
GHASEDAK_MOCK_GATEWAY=        # گام F0-7 — خالی/خاموش در production (صفحهٔ درگاه آزمایشی 404)
ZARINPAL_SANDBOX=false        # فقط پس از درست‌بودن Merchant ID واقعی
# GHASEDAK_WORKERS را برای تک‌پروسه ساده unset کنید؛ برای چند worker = on
```

**پورت‌های کانونیکال (F0-4 — بدون ابهام):** لوکال dev: API ۴۰۰۰ · فروشگاه ۳۱۱۱ · پنل ۳۲۰۰ · کلستر اصلی `5433` · کلستر تمرین `55433`. روی سرور production فقط همان پورتی که سرویس‌ها واقعاً گوش می‌دهند (معمولاً API ۴۰۰۰ پشت reverse-proxy و postgres ۵۴۳۲). `run-local.sh` این‌ها را یک‌جا ست می‌کند.

**گارد بوت (F0-4):** API اگر به دیتابیس نرسد **بالا نمی‌آید** و پیام فارسی با هدف اتصال (`host:port/db`، بدون رمز) و پورت‌های کانونیکال در لاگ می‌نویسد؛ پس شکست اتصال در استقرار بلافاصله دیده می‌شود، نه در اولین درخواست مشتری.

فایل `apps/api/.env.local` را دستی نسازید — پنل خودش می‌نویسد (کلیدها را از کارت‌های «پیامک و درگاه پرداخت» و «وب‌سرویس» وارد کنید).

### ۳.۳ دیتابیس
```bash
cd packages/database
pnpm db:deploy                # ساخت شِما از migrationهای خود ریپو
pnpm db:seed                  # فقط بار اول: کانال/انبار/حساب‌ها/کاربر ادمین (tsx)
```
> برای rehearsal/تست محلی همین الگو با پورت و نام DB جدا (مثلاً `55433/p11dev`) بدون تغییر دیگری کار می‌کند.

### ۳.۴ build
```bash
pnpm -r build                 # یا جدا: apps/api → npm run build، سپس دو اپ Next
```

### ۳.۵ اجرا به‌عنوان سرویس (ویندوز)
برای هر سرویس یکTask زمان‌بند یا NSSM بسازید؛ الگوی بوت بدون پنجره:
```powershell
Start-Process -WindowStyle Hidden -FilePath node -ArgumentList 'dist/main.js' -WorkingDirectory 'C:\deploy\ghasedak\apps\api'
Start-Process -WindowStyle Hidden -FilePath cmd -ArgumentList '/c','npx next start -p 3111' -WorkingDirectory 'C:\deploy\ghasedak\apps\storefront'
Start-Process -WindowStyle Hidden -FilePath cmd -ArgumentList '/c','npx next start -p 3200' -WorkingDirectory 'C:\deploy\ghasedak\apps\admin'
```
نکتهٔ واقعی این ریپو: اجرای `next start` داخل شل با فرزندان بعد از timeout شل کشته می‌شود — حتماً **detached** بالا بیاورید (NSSM/Task Scheduler بهترین است).

## ۴. درگاه پرداخت واقعی (زرین‌پال)

1. وارد پنل ادمین شوید → **سیستم ← پیامک و درگاه پرداخت**.
2. در کارت «درگاه پرداخت»، Merchant ID (UUID ۳۶ کاراکتری از پنل زرین‌پال) را وارد و ذخیره کنید؛ سپس **تست اتصال** — پاسخ موفق یعنی `Pay.Request` واقعی جواب داده (`authority` برمی‌گردد).
3. تا وقتی `ZARINPAL_SANDBOX=true` است همهٔ تراکنش‌ها به `sandbox.zarinpal.com` می‌روند؛ برای پذیرش پول واقعی `ZARINPAL_SANDBOX=false` و Merchant ID واقعی لازم است.
4. مسیرهای API زرین‌پال `/pg/v4/payment/request.json` و `/pg/v4/payment/verify.json`اند (تأییدشده با پروب واقعی سندباکس).
5. Callback درگاه باید به `https://<دامنهٔ فروشگاه>/api/pay/callback` برسد (فقط ثبت می‌کند؛ تایید نهایی فقط verify سمت سرور).

## ۵. پیامک واقعی

در همان صفحه، اپراتور (کاوه‌نگار/قاصدک‌اس‌ام‌اس/ملی‌پیامک/…) را انتخاب، کلید API همان اپراتور را وارد و ذخیره کنید — کلید بلافاصله در فرایند جاری فعال می‌شود. «تست» بدون کلید هرگز موفق جعلی نمی‌دهد (`REQUIRES_CREDENTIAL`). ارسال واقعی فقط با کلید واقعی شما.

## ۵٫۵ ایمیل تراکنشی (SMTP)

ایمیل از همان صف `Notification` می‌رود؛ آداپتور **SMTP بدون SDK** است (`node:tls` + `AUTH LOGIN`) و اتصال را **همیشه TLS** برقرار می‌کند — پس پورتی بدهید که TLS بپذیرد (۴۶۵ رایج‌ترین؛ ۵۸۷ هم در عمل با همین اتصال کار می‌کند).

1. وارد پنل ادمین شوید → **سیستم ← پیامک و درگاه پرداخت** → کارت «کلیدهای API»؛ `SMTP_HOST`، `SMTP_PORT`، `SMTP_USER`، `SMTP_PASS`، `SMTP_FROM` را وارد و ذخیره کنید (در `apps/api/.env.local` نوشته می‌شود؛ همان مسیر پیامک).
2. API را ری‌استارت کنید تا فرایند جدید مقادیر را بخواند (پیامک بلافاصله فعال می‌شود؛ متغیرهای SMTP در بوت خوانده می‌شوند).
3. **تست واقعی:** در فروشگاه → «بازیابی رمز» → کانال **ایمیل** را بزنید و ایمیل حساب خودتان را وارد کنید؛ سپس در پنل → **سیستم ← اعلان‌ها و صف ارسال** ردیف را ببینید: «ارسال‌شده» با زمان ارسال = موفق؛ «در صف» + `NOT_CONFIGURED` = متغیرها ذخیره/بوت نشده‌اند. برای برداشتن دستی صف: همان صفحه → «dispatch فوری» (`POST /admin/capabilities/notifications/dispatch`).
4. بدون credential هیچ‌وقت «ارسال شد» جعلی ثبت نمی‌شود: ردیف در صف می‌ماند و `lastError` می‌گوید چه کم است (بند ۱۱۱).

> نکتهٔ امنیتی: در بازیابی رمز، پاسخ برای حساب موجود و ناموجود **یکسان** است و اگر کانال انتخابی دادهٔ مخاطب نداشته باشد هیچ کد بی‌اطلاع کاربر از راه دیگری نمی‌رود.

## ۵٫۶ آنالیتیکس (GA4 — گام ۱۵)

سازوکار: اسکریپت GA4 در فروشگاه **فقط پس از رضایت کاربر** از بنر لود می‌شود (رضایت در جدول `ConsentRecord` با هویت نشست ناشناس ثبت می‌شود). شمارش بازدید first-party خودمان (جدول روزانهٔ تب «بازدید فروشگاه») اما **همیشه فعال است و به رضایت وصل نیست** (تصمیم D-5: دادهٔ تجمیعیِ بدون PII؛ رضایت فقط دروازهٔ گوگل است). رویداد `purchase` از **سمت سرور** می‌رود (Measurement Protocol) — مستقل از رضایت و adblock، دقیقاً یک‌بار با تایید پرداخت.

1. در پنل GA4 یک جریان Web بسازید و `Measurement ID` (قالب `G-…`) را در `NEXT_PUBLIC_GA4_MEASUREMENT_ID` بگذارید — این مقدار عمومی است و در HTML دیده می‌شود.
2. در همان صفحهٔ جریان، بخش «Measurement Protocol API secrets» → یک secret بسازید و در `GA4_API_SECRET` بگذارید — فقط سمت سرور است؛ هرگز در storefront build نشود.
3. API همان `NEXT_PUBLIC_GA4_MEASUREMENT_ID` را می‌خواند؛ اگر فایل‌های env جدا دارید، می‌توانید به‌جایش `GA4_MEASUREMENT_ID` را فقط در env سرویس API بگذارید.
4. خاموش صادقانه: اگر هر دو مقدار ست نباشند، هیچ درخواستی به GA4 نمی‌رود و در بوت API هشدار `NOT CONFIGURED` لاگ می‌شود — هیچ «ارسال شد» جعلی ثبت نمی‌شود (بند ۱۱۱).
5. تست واقعی: یک سفارش سندباکسی کامل کنید؛ در DebugView پنل GA4 باید رویداد `purchase` با `transaction_id` = کد سفارش ببینید. UTM ورودی (اولین بازدید) روی خود سفارش هم ذخیره می‌شود (`utm_source/utm_medium/utm_campaign`).

## ۶. بکاپ و بازیابی

- اسکریپت: `node infrastructure/backup/ghasedak-backup.mjs --url "<DATABASE_URL>" --out C:/ghasedak-backups`
- خروجی: `data/<Table>.csv` برای همهٔ جدول‌ها + `manifest.json` (COUNT + sha256) + `backup.log`؛ کد خروج غیرصفر = شکست.
- زمان‌بندی پیشنهادی: Task Scheduler روزانه ۰۲:۰۰ (همان الگوی فعلی). توجه: اگر سرویس PostgreSQL **روشن** باشد ولی DB اشتباه بدهید، بکاپ fail می‌شود؛ وضعیت را از manifest آخرین اجرا بخوانید.
- بازیابی: migrationها + CSVها را همان ترتیب در DB تازه اعمال کنید (restore-test همین مسیر را خودکار می‌کند).

## ۷. چک‌لیست پس از استقرار

- [ ] `GET http://127.0.0.1:4000/api/v1/health` → 200
- [ ] ورود ادمین و آپلود لوگو/محصول واقعی
- [ ] ثبت سفارش مهمان از فروشگاه تا صفحهٔ پرداخت (اثبات چرخهٔ خرید)
- [ ] تست اتصال درگاه (سندباکس) سبز
- [ ] تست کلید پیامک با شمارهٔ خودتان
- [ ] تست ایمیل تراکنشی: بازیابی رمز با کانال ایمیل → ردیف «ارسال‌شده» در صف اعلان‌ها
- [ ] بکاپ دستی اول + بررسی `manifest.json`
- [ ] آنالیتیکس: سفارش سندباکسی → رویداد `purchase` در GA4 DebugView با کد سفارش درست
- [ ] `NODE_ENV=production` و `ZARINPAL_SANDBOX=false` فقط بعد از اطمینان

## ۸. عیب‌یابی سریع

| علامت | علت رایج | اقدام |
|---|---|---|
| «درگاه پرداخت اینترنتی فعال نیست» | Merchant ID ذخیره نشده یا env قدیمی قبل از بوت | ذخیرهٔ Merchant از کارت درگاه؛ در صورت شک ری‌استارت API |
| درگاه redirect می‌دهد ولی پرداخت ناموفق | `ZARINPAL_SANDBOX=false` با Merchant سندباکس | یکی را واقعی کنید |
| SMS تست «تنظیم نشده» | کلید اپراتور فعال ذخیره نشده | کارت پیامک → کلید → ذخیره |
| ایمیل بازیابی رمز در صف می‌ماند | `SMTP_*` ذخیره نشده یا API بعد از ذخیره ری‌استارت نشده | کارت «کلیدهای API» → مقادیر → ری‌استارت API؛ سپس dispatch فوری |
| storefront محصولات را نمی‌بینید | `API_ORIGIN` اشتباه یا API پایین | `curl 127.0.0.1:4000/api/v1/catalog/products` |
| purchase در GA4 ثبت نمی‌شود | `GA4_API_SECRET`/Measurement ID ست نشده (هشدار بوت API) یا سرور به `google-analytics.com` نمی‌رسد | env سرویس API را چک کنید؛ در ایران خروجی GA4 ممکن است نیاز به پروکسی خروجی داشته باشد |
| بنر رضایت نمی‌آید | `NEXT_PUBLIC_GA4_MEASUREMENT_ID` خالی است (بدون آن، آنالیتیکس کاملاً خاموش است) | مقدار `G-…` را در env فروشگاه بگذارید و rebuild کنید |
| بکاپ lastResult=1 | DB در دسترس نیست یا کرئنشیال غلط | لاگ `backup.log` آخرین اجرا |

## ۹. دامنهٔ کانونیکال و ریدایرکت ۳۰۱ (گام ۲۰ — تصمیم #۴)

کانونیکال `https://www.lebaszirghasedak.ir` است؛ `lebaszirghasedak.ir` (بدون www) باید با **۳۰۱ دائمی** به www برود و هیچ صفحه‌ای روی apex ایندکس نشود.

- **داخل Next:** `apps/storefront/middleware.ts` همین ریدایرکت را انجام می‌دهد (فقط در production و فقط اگر هاست واقعاً apex باشد؛ با `CANONICAL_HOST` قابل تست است). پایان‌اسلش هم همان‌جا با ۳۰۸ حذف می‌شود (`/path/` → `/path`).
- **در reverse-proxy (الزامی):** لایهٔ proxy هم باید همین قاعده را داشته باشد تا حتی وقتی Next پایین است، apex بسته بماند:

  nginx:
  ```nginx
  server {
    listen 443 ssl;
    server_name lebaszirghasedak.ir;
    return 301 https://www.lebaszirghasedak.ir$request_uri;
  }
  ```
  caddy:
  ```caddyfile
  lebaszirghasedak.ir {
    redir https://www.lebaszirghasedak.ir{uri} permanent
  }
  ```

- SSL برای **هر دو** دامنه (www و apex) لازم است؛ `CORS_ORIGINS` فقط دامنهٔ کانونیکال.
- پنل ادمین روی ساب‌دامین جدا (`admin.lebaszirghasedak.ir` با `X-Robots-Tag: noindex`) پیشنهاد می‌شود — جزئیات در سند تصمیم‌ها.

## ۱۰. CSRF و مبدأهای مجاز (گام ۲۲)

- **فروشگاه:** همهٔ routeهای مینت (سبد، نظر، تسویه، شروع پرداخت، آمار/رضایت) با الگوی double-submit بررسی می‌شوند: کوکی `csrf_token` (در middleware ساخته می‌شود) باید در هدر `x-csrf-token` برگردد؛ کلاینت این کار را با `csrfHeaders()` از `apps/storefront/lib/csrf.ts` انجام می‌دهد.
- **API ادمین:** کنترلرهای حساس مالی (`orders`, `payments`, `admin/settlements`, `admin/treasury`, `admin/accounting`, `admin`, `admin/capabilities/credentials`, `admin/capabilities/payment-gateway`) گارد `CsrfGuard` دارند: یا هدر double-submit درست، یا `Origin`/`Referer` هم‌مبدأ؛ بدون هر دو (fetch سمت‌سرور/callback درگاه) عبور می‌کند.
- **متغیر محیطی:** `CSRF_ALLOWED_ORIGINS` — فهرست با کاما از مبدأهای مجاز پنل/فروشگاه (مثلاً `https://www.lebaszirghasedak.ir,https://admin.lebaszirghasedak.ir`). اگر ست نشود از `CORS_ORIGINS` خوانده می‌شود. در محیط توسعه localhost همیشه مجاز است.

## ۱۱. مانیتورینگ و هشدار (گام ۲۳ — تصمیم #۷ بدون SaaS جدید)

### ۱۱.۱ ابزار uptime بیرونی

`GET /api/v1/health` را با هر ابزاری (UptimeRobot، Uptime Kuma، cron سرور) پایش کنید؛ فقط وقتی `status` برابر `ok` است سالم است. این پاسخ شامل `checks.db`، `version` و `uptimeSeconds` هم می‌شود و پاسخ آنی است (زیر ۱ ثانیه).

### ۱۱.۲ کانال هشدار (تلگرام با env — بدون UI اضافه)

```ini
ALERT_TELEGRAM_BOT_TOKEN=<توکن ربات از BotFather>
ALERT_TELEGRAM_CHAT_ID=<شناسهٔ چت/کانال — با ربات‌تان پیام بدهید و id را از getUpdates بخوانید>
ALERT_EMAIL=<اختیاری — گیرندهٔ ایمیل جایگزین؛ پیش‌فرض SMTP_USER>
```

رفتار: تلگرام (فراخوانی مستقیم Bot API) ← اگر نبود/شکست خورد، ایمیل از همان SMTP صف `Notification` ← اگر هیچ‌کدام ست نیست، **dry-run** با لاگ ساخت‌یافته (`component=alerting, status=DRY_RUN`) — در تست هرگز ارسال واقعی نمی‌شود. هر نوع هشدار حداکثر یک‌بار در ۳۰ دقیقه ارسال می‌شود (طوفان‌گریز).

### ۱۱.۳ فهرست هشدارها و آستانه‌ها

| نوع | شرط | منبع |
|---|---|---|
| `HEALTH_DOWN` | دیتابیس در ۲ بررسی پشت‌سرهم (هر ۱ دقیقه) در دسترس نیست | HealthWatch |
| `HTTP_5XX_SPIKE` | بیش از ۱۰ خطای ۵xx در ۵ دقیقهٔ اخیر | شمارندهٔ `http-exception.filter` |
| `DISK_HIGH` | بیش از ۸۵٪ فضای پارتیشن داده پر باشد (هر ۵ دقیقه) | HealthWatch |
| `BACKUP_FAILED` | آخرین manifest بکاپ ناقص یا بدون verify (هر ۶۰ دقیقه) | HealthWatch (فقط خواندن دیسک) |
| `WORKER_ERROR` | event-bus یا dispatcher اعلان‌ها خطا دید | heartbeat ساخت‌یافتهٔ هر worker |
| `PAYMENT_MISMATCH` | تایید پرداخت درگاه ناموفق (مبلغ/ارجاع هم‌خوان نیست یا درگاه رد کرده) | `payments.service.verify` |

**نکتهٔ بکاپ:** خودِ بکاپ با Task Scheduler ویندوزی گرفته می‌شود (بخش ۶)؛ هشدار بالا فقط سلامتِ «آخرین اجرا» را از روی دیسک می‌خواند. اگر بکاپ را بیرون از این سرور می‌گیرید، همان مسیر manifest را پایش کنید یا ابزار بیرونی روی فایل خروجی بگذارید.

### ۱۱.۴ دو موردِ معلق (کد نشده — صریح)

1. **اعتبار پیامک:** sms-providers فعلی API گزارش credit ندارد و در Settings چیزی برای آستانه ذخیره نمی‌شود؛ پس هشدار خودکار اعتبار **نداریم**. پنل ارائه‌دهنده (کاوه‌نگار و…) خودش هشدار اعتبار می‌دهد — به پنل اپراتور اعتماد کنید یا بعداً اگر endpoint credit اضافه شد، همان‌جا به رأس هشدار وصل شود.
2. **تطبیق کامل تسویهٔ درگاه:** منطق مقایسه‌ای مستقل هنوز کامل نیست. هوک نقطهٔ «پرداخت موفق ولی مبلغ/ارجاع ناسازگار» گذاشته شده (هشذار `PAYMENT_MISMATCH`) و مبالغ unmatched در خروجی `GET /admin/diagnostics` فقط **گزارش** می‌شوند (چک `treasury-match`) — هشدار خودکار ندارد.

## ۱۲. چت‌بات هوشمند قاصدک (گام ۱۸-۳ — AI Chat)

### ۱۲.۱ پیکربندی متغیرهای محیطی

افزودن سه متغیر در `.env` (یا `apps/api/.env.local` که پنل ادمین می‌نویسد):

```ini
AI_BASE_URL=https://api.falkor.ai/v1      # یا هر endpoint OpenAI-compatible
AI_API_KEY=sk-...                          # کلید API ارائه‌دهنده
AI_MODEL=falkor-1                          # نام مدل (پاسخ API `models.list` برای تأیید)
GHASEDAK_API_KEY=<کلید تصادفی طولانی>     # کلید سرویس‌به‌سرویس فروشگاه→API (پایین را ببینید)
```

**نکته:** هرگز `NEXT_PUBLIC_` پیشوند ندهید — این کلیدها فقط سمت سرور (API و فروشگاه) هستند.

**پیکربندی mock محلی (صرفاً اطلاع تاریخی):** در production فقط از endpoint، کلید و مدل واقعی ارائه‌دهنده استفاده کنید؛ در نبود هرکدام از سه متغیر، مسیر AI پاسخ `REQUIRES_CREDENTIAL` می‌دهد و پاسخی جعل نمی‌کند (بند ۱۱۱). TLS نامعتبر را در production نادیده نگیرید.

**جداسازی کلیدها:** `GHASEDAK_API_KEY` فقط برای مسیرهای داخلیِ سرویس‌به‌سرویس است و برای چت هوشمند لازم نیست. مسیر چت مشتری در نسخهٔ فعلی عمومی و مستقل است؛ proxy فروشگاه نه کوکی و نه کلید سرویس را به API می‌فرستد. `AI_BASE_URL`، `AI_API_KEY` و `AI_MODEL` را فقط در محیط امن API تنظیم کنید؛ هرگز آن‌ها را با `NEXT_PUBLIC_` به مرورگر نبرید.

### ۱۲.۲ راه توصیه‌شده: پیکربندی و تست از پنل ادمین

1. وارد پنل ادمین شوید → **سیستم ← پیامک و درگاه پرداخت** (مسیر: `/settings/capabilities`).
2. کارت هوشمند تنظیم AI، Base URL، کلید (نمایش ماسک‌شده) و مدل را می‌گیرد؛ `GET /admin/capabilities/ai` وضعیت را می‌خواند.
3. با **ذخیره**، `POST /admin/capabilities/ai/settings` تنظیمات را در فایل امن `apps/api/.env.local` (خارج از git) ثبت می‌کند؛ کلید خالی یعنی مقدار قبلی تغییر نکند.
4. **تست اتصال** (`POST /admin/capabilities/ai/test`) یک درخواست واقعی به مدل می‌فرستد و پاسخ آزمایشی را نشان می‌دهد. این تست هزینهٔ احتمالی provider دارد؛ فقط پس از تنظیم کلید واقعی اجرا کنید.

### ۱۲.۳ نحوه کارکرد

- **چت مشتری:** مرورگر `POST /api/ai/chat` را روی Storefront صدا می‌زند؛ proxy سرور به `POST /api/v1/customer-chat` در API وصل می‌شود. هر دو JSON و SSE پشتیبانی می‌شوند. این مسیر عمومی است و کوکی/کلید ادمین نمی‌خواهد؛ خطای provider یا جزئیات credential به مشتری بازتاب نمی‌شود.
- **دستیار ادمین:** `POST /api/v1/admin/assistant/query` فقط‌خواندنی است و مجوز `accounting.reports` می‌خواهد. پاسخ به گزارش‌های مالی مجاز و محدود متکی است؛ منبع و تاریخ داده کنار پاسخ برمی‌گردد. موضوع خارج از دامنه بدون فراخوانی مدل رد می‌شود؛ این MVP هنوز گزارش جریان نقدی، سفارش و انبار را پوشش نمی‌دهد.
- **اعتبارسنجی و کاتالوگ:** تاریخچه حداکثر ۱۰ پیام، هر پیام حداکثر ۲۰۰۰ نویسه و نقش‌ها فقط `user`/`assistant` هستند. برای چت مشتری، retrieval فقط محصولات منتشرشده را می‌خواند (حداکثر ۵ نتیجهٔ مرتبط)؛ به سبد، هویت مشتری یا وضعیت سفارش دسترسی ندارد و نباید این موارد را حدس بزند.
- **Rate limit:** سقف چت عمومی ۲۰ درخواست در دقیقه در Storefront و API است. limiterها حافظه‌ای و per-process هستند، نه quota پایدار یا هزینه‌محور؛ سرآیندهای IP فقط وقتی قابل اتکا هستند که reverse proxy مورد اعتماد آن‌ها را درست بازنویسی کند. قبل از لانچ، این پیکربندی و رفتار چندنمونه‌ای باید آزموده شود.
- **Credential:** `AI_BASE_URL`، `AI_API_KEY` و `AI_MODEL` فقط در API لازم‌اند؛ تنظیم ناقص با `REQUIRES_CREDENTIAL` پاسخ داده می‌شود و پاسخ ساختگی تولید نمی‌شود.

### ۱۲.۴ ادغام در فروشگاه (Storefront)

- ویجت: `components/commerce/ChatWidget.tsx` — أسفل‌چپ (موبایل) / مودال (دسکتاپ)، RTL، Accessible (ARIA، فوکوس‌ترپ، Escape).
- کلاینت: `lib/ai-client.ts` — `aiChat(messages)` و `aiChatStream(messages, onChunk)` برای SSE.
- تاریخچهٔ رابط در `localStorage` (`ghasedak-chat-history`) تا ۷ روز می‌ماند و هنگام ادامهٔ گفتگو برای پاسخ‌گویی دوباره به API فرستاده می‌شود؛ این تاریخچه، حافظهٔ سروری یا تاریخچهٔ حساب مشتری نیست. روی دستگاه مشترک، کاربر باید گفتگو را پاک کند.

### ۱۲.۵ عیب‌یابی

| علامت | علت | اقدام |
|---|---|---|
| `REQUIRES_CREDENTIAL` در چت مشتری | یکی از تنظیمات ارائه‌دهندهٔ AI در API خالی است | `AI_BASE_URL`، `AI_API_KEY` و `AI_MODEL` را در تنظیمات امن پنل/API کامل و وضعیت را دوباره بررسی کنید؛ کلید سرویس Storefront برای این مسیر لازم نیست |
| `REQUIRES_CREDENTIAL` (از تست اتصال پنل) | `AI_BASE_URL` یا `AI_API_KEY` خالی | در پنل ادمین کارت «چت‌بات هوشمند» پر/ذخیره/تست کنید |
| `VALIDATION_ERROR` | پیام خالی/بیش از ۲۰۰۰ کاراکتر/نقش `system` | اعتبارسنجی کلاینت/سرور — ورودی را اصلاح کنید |
| `AI_PROVIDER_ERROR` | اتصال به ارائه‌دهنده برقرار نشد یا پاسخ غیر 2xx/timeout داد | `AI_BASE_URL`/`AI_MODEL` را چک کنید؛ لاگ API را ببینید |
| `AI_EMPTY` | ارائه‌دهنده reachable ولی پاسخ خالی داد | نام مدل را از `models.list` ارائه‌دهنده تأیید کنید |
| SSE قطع می‌شود | Proxy/Load Balancer timeout | `proxy_read_timeout` (nginx) / `timeout` (caddy) ≥ ۶۰ ثانیه |
| ویجت باز نمی‌شود | `localStorage` پر/خطای hydration | در DevTools → Application → LocalStorage → `ghasedak-chat-history` پاک کنید |

## ۱۳. سرور لینوکس واقعی (گام ۳۳ — اجرا شد ۲۰۲۶-۱۰-۲۹)

بخش‌های بالا (ویندوز / Task Scheduler) برای dev محلی‌اند. نسخهٔ واقعی روی VPS ایرانی با اسکریپت‌های `infrastructure/deploy/server/` بالا می‌رود:

| مورد | مقدار |
|---|---|
| سرور | `79.127.11.91` — Ubuntu 24.04، ۲ vCPU / ۲گیگ رم / ۶۴گیگ (swap ۴گیگ) |
| SSH | پورت **6579** (نه 22) + فقط کلید؛ رمز root غیرفعال است |
| مسیر اپ | `/opt/ghasedak` (کاربر سیستمی `ghasedak`) |
| env | `/opt/ghasedak/.env` (وضعیت 600؛ رمز DB را `bootstrap.sh` یک‌بار تولید می‌کند) |
| سرویس‌ها | `ghasedak-api` (4000)، `ghasedak-storefront` (3111)، `ghasedak-admin` (3200) — هر سه `enabled` (با بوت بالا می‌آیند) |
| reverse proxy | nginx: apex با **301** به `www`، HSTS روی هر دو دامنه، پنل با `X-Robots-Tag: noindex` |
| SSL | Let's Encrypt (webroot) روی `www` + apex + `admin`؛ تمدید خودکار با certbot.timer |
| دیتابیس | PostgreSQL محلی روی 5432؛ فقط `127.0.0.1` (از بیرون بسته) |

**اجرا (روی سرور):**

```bash
bash /root/ghasedak-deploy/bootstrap.sh   # یک‌بار: پکیج‌ها، Node، DB، فایروال، env
bash /root/ghasedak-deploy/deploy.sh     # هر بار: کد ← build ← سرویس ← SSL ← health
```

**به‌روزرسانی سایت بعد از هر commit:** همان `deploy.sh` را دوباره اجرا کنید — pull با `--ff-only` (اگر شعبه محلی جلو رفته باشد متوقف می‌شود)، `pnpm install`، migrate، seed فقط وقتی جدول `User` خالی باشد، build با turbo (کش‌خورده، چند ثانیه)، ری‌استارت سرویس‌ها و probe سلامت. خروجی در `/root/ghasedak-deploy/deploy.log`.

**نکات عملیاتی:**

- لاگ‌ها: `journalctl -u ghasedak-api -f` (یا `ghasedak-storefront` / `ghasedak-admin`).
- گواهی: `certbot certificates` — تمدید خودکار است؛ پس از هر استقرار `nginx -t` و reload انجام می‌شود.
- رسانه‌ها در `/opt/ghasedak/apps/data/media` می‌مانند (در git نیستند؛ `git pull` دست نمی‌زند).
- فایروال: `ufw status` → فقط 6579/80/443 باز؛ API و پورت‌های Next عمداً از بیرون بسته‌اند.
- رمز root اگر لازم شد از پنل آذرآنلاین reset می‌شود؛ کلید دسترسی `ghasedak_deploy_ed25519` جایگزین آن است.
