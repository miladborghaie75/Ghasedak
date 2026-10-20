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
