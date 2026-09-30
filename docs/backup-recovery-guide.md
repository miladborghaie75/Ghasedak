# راهنمای پشتیبان‌گیری و بازیابی قاصدک — بند ۴ (فارسی، عملیاتی)

این راهنما خلاصهٔ عملیاتی برای **اپراتور** است؛ جزئیات فنی در `infrastructure/backup/README.md` و `infrastructure/backup/scheduled-task/README.md` است. همهٔ دستورها همان‌هایی است که روی همین سیستم اجرا و اثبات شده‌اند.

## ۱) چرخهٔ روزانه چه می‌کند؟ (وضعیت فعلی)

- تسک ویندوزی **GhasedakDailyBackup** هر روز ساعت **۰۲:۰۰** (به‌وقت تهران) اجرا می‌شود؛ نتیجه در پنل ادمین → سیستم → **پشتیبان‌گیری** (`/settings/backup`) قابل مشاهده است: آخرین بکاپ (کامل/ناقص، تأییدشده/تأییدنشده)، زمان‌بند (آخرین اجرا/نتیجه/اجرای بعدی) و تاریخچه.
- خروجی: `C:\ghasedak-backups\<زمان-مهر>\` شامل `data/*.csv` (۱۳۵ جدول)، `manifest.json` (تعداد/بایت/sha256 هر جدول)، `backup.log` و (در صورت اجرای verify) `verify.json`.
- **سیاست: بدون حذف خودکار** — retention دستی است؛ ریسک حذف ناخواستهٔ بکاپ معتبر صفر است. (پنل تعداد نسخه‌های فعال/حذف‌شده با نشان `DELETED` را می‌شمارد.)
- API هرگز مستقیم بکاپ نمی‌گیرد و بازیابی نمی‌کند؛ پنل فقط **وضعیت واقعی** را از دیسک می‌خواند (بدون فیک — بند ۱۱۱).

## ۲) چک سلامت روزانه (۳۰ ثانیه)

```bash
# وضعیت زنده از CLI (معادل کارت پنل):
powershell -NoProfile -Command "Get-ScheduledTask -TaskName GhasedakDailyBackup | Get-ScheduledTaskInfo | Format-List"
tail -3 C:/ghasedak-tools/backup-cron.log
node infrastructure/backup/rehearsal/verify-backup.mjs "C:/ghasedak-backups/<آخرین-پوشه>"
# انتظار: BACKUP_VERIFY_PASSED
```

هر روز صبح فقط سه چیز را نگاه کنید: `LastTaskResult=0`، خط `done: ok=135/135` در لاگ، و نشان **کامل/تأییدشده** در پنل.

## ۳) بکاپ دستی (قبل از هر مهاجرت/استقرار/تغییر خطرناک)

```bash
node infrastructure/backup/ghasedak-backup.mjs --url "<DATABASE_URL>" --out C:/ghasedak-backups
node infrastructure/backup/rehearsal/verify-backup.mjs "C:/ghasedak-backups/<آخرین-پوشه>"
```

- کد خروج `0` = کامل؛ `2` = partial؛ غیرصفر verify = **هرگز آن نسخه را مبنا قرار نده**.
- gate استقرار (`node infrastructure/deploy/gate-b1.mjs pre --url ... --out C:/ghasedak-backups`) همین کار را خودکار می‌کند: بکاپ + verify + diff اسکیمای prod با HEAD.

## ۴) تست بازیابی (هر بکاپ، همان روز)

```bash
cd infrastructure/backup
NODE_PATH=C:/ghasedak-tools/pg-client/node_modules node ghasedak-restore-test.mjs --backup C:/ghasedak-backups/<stamp>
```

این دستور واقعاً بازیابی می‌کند (بدون دست‌زدن به prod): دیتابیس موقت می‌سازد، migrationهای ریپو را `deploy` می‌کند، CSVها را `COPY FROM STDIN` می‌کند و COUNT هر جدول را با manifest می‌سنجد. خروجی صفر یعنی بکاپ **اثبات‌شده قابل‌بازیابی** است. با `--keep` می‌توانید DB موقت را برای بررسی نگه دارید.

## ۵) بازیابی واقعی (فاجعه — گام‌به‌گام)

**اصل طلایی: بازیابی فقط روی دیتابیس تازه + migration، نه روی دیتابیس آسیب‌دیده.**

```bash
# ۰) prod PG روشن باشد:
("C:/ghasedak-pg/bin/bin/pg_ctl.exe" -D "C:/ghasedak-pg/data" -l "C:/ghasedak-pg/data/ghasedak.log" -o "-p 5433 -h 127.0.0.1" start &)

# ۱) دیتابیس تازه بساز (کاملاً خالی):
cd C:/ghasedak-tools/pg-client && node one-off.mjs "postgresql://postgres:<pw>@127.0.0.1:5433/postgres" "CREATE DATABASE ghasedak_new;"

# ۲) اسکیمای دقیق prod را از خود ریپو بریز (migration رسمی — نه دستی):
cd <ریپو>/packages/database
DATABASE_URL="postgresql://postgres:<pw>@127.0.0.1:5433/ghasedak_new" pnpm prisma migrate deploy
# (اگر pnpm prisma نبود: node ../../packages/database/node_modules/prisma/build/index.js migrate deploy)

# ۳) داده را برگردان — ghasedak-restore-test.mjs مسیر آماده دارد؛ مقصد را دستی بده:
cd infrastructure/backup
NODE_PATH=C:/ghasedak-tools/pg-client/node_modules node -e "
const m=require('./rehearsal/restore-csv.mjs');
" 
# توصیه عملی: از خود ghasedak-restore-test.mjs استفاده کن ولی admin-url را به 5433/postgres بده و
# داخل اسکریپت اسم DB مقصد را ghasedak_new بگذار؛ خروجی صفر = COUNT همهٔ جداول با manifest یکی است.

# ۴) سوییچ نهایی (تأیید شمارش‌ها اول):
#    - سرویس‌ها را متوقف کن (API/admin/storefront)
# ۵) سوییچ: اسم‌ها را عوض کن — قدیمی را ghasedak_broken_<تاریخ> و ghasedak_new را ghasedak
cd C:/ghasedak-tools/pg-client && node one-off.mjs "postgresql://postgres:<pw>@127.0.0.1:5433/postgres" "ALTER DATABASE ghasedak RENAME TO ghasedak_broken_<تاریخ>;"
cd C:/ghasedak-tools/pg-cluster-mgr 2>/dev/null || true
cd C:/ghasedak-tools/pg-client && node one-off.mjs "postgresql://postgres:<pw><pw>@127.0.0.1:5433/postgres" "ALTER DATABASE ghasedak_new RENAME TO ghasedak;"
# ۶) prod PG را ری‌استارت کن، سرویس‌ها را بالا بیاور، smoke بگیر (cashflow با baseline مقایسه شود)
```

نکات حیاتی:
- **هیچ‌وقت** روی `ghasedak` آسیب‌دیده بازنویسی نکن؛ همیشه `ghasedak_new` + سوییچ نام.
- پس از سوییچ، اولین کار: بکاپ تازه بگیر (اولین بکاپ از state بازیابی‌شده).
- `verify.json` کنار manifest، امضای verify است؛ پنل نشان «تأییدشده» را از همین می‌خواند.

## ۶) سرویس‌ها بعد از بازیابی

```bash
# API (با DATABASE_URL prod):
cd apps/api && DATABASE_URL="<prod-url>" PORT=4000 GHASEDAK_WORKERS=off node dist/main.js
# ادمین و فروشگاه:
cd apps/admin && node node_modules/next/dist/bin/next start --port 3200
cd apps/storefront && node node_modules/next/dist/bin/next start -p 3111
```

## ۷) عیب‌یابی سریع

| نشانه | علت رایج | کار |
|---|---|---|
| `LastTaskResult=1` در Scheduler | مسیر با حروف فارسی/mojibake (تاریخچهٔ ثابت‌شده) | wrapperهای ASCII در `C:/ghasedak-tools/run-backup.cmd/.ps1` دست‌نخورده بمانند |
| `done: ok=134/135` یا کمتر | جدولی در لحظهٔ بکاپ قفل بوده | بکاپ را partial حساب کن؛ بلافاصله بکاپ مجدد بگیر و verify کن |
| پنل «یافت نشد» برای تسک | حذف/تغییرنام تسک | بازسازی با `infrastructure/backup/scheduled-task/` (S4U + battery flags) |
| `BACKUP_VERIFY_FAILED` | خرابی دیسک/فایل ناقص | آن نسخه را استفاده نکن؛ بکاپ جدید + تست بازیابی؛ نسخهٔ هفتگی خارج از دیسک را چک کن |

## ۸) چک‌لیست هفتگی

- [ ] یک نسخهٔ هفتگی را **خارج از دیسک سیستم** کپی کن (درایو دیگر/اورکلاد).
- [ ] روی یک نسخهٔ تصادفی `ghasedak-restore-test.mjs` اجرا کن (اثبات مستمر قابل‌بازیابی بودن).
- [ ] تعداد نسخه‌های فعال را ببین؛ بیش از ~۳۰ نسخه → پاکسازی دستی (مکان: `C:\ghasedak-backups`).
- [ ] لاگ `C:/ghasedak-tools/backup-cron.log` را برای خطای روزانهٔ اخیر اسکن کن.
