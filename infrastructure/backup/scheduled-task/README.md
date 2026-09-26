# Scheduled Backup Job — تعمیر و راه‌اندازی (بند ۹۳)

## Root Cause شکست قبلی (اثبات‌شده)

`C:\ghasedak-tools\run-backup.cmd` مسیر اسکریپت را **با حروف فارسی** داخل خود داشت:
`node "C:\Users\milad\OneDrive\Desktop\سایت فریباف\..."` — کانتکست Task Scheduler با
codepage ANSI 1256 اجرا می‌شود و این literal را به mojibake (`╪│╪د█î╪ز ...`) تبدیل کرد؛
node مسیر را نیافت → `MODULE_NOT_FOUND` → `LastTaskResult=1` (اثبات: `backup-cron.log`
از 2026-09-25 02:00 + بازتولید live). **هیچ بکاپی بعد از baseline ساخته نشده بود.**

## ساختار تعمیرشده (ASCII-only, absolute-path, fail-fast)

| فایل (زنده) | نسخهٔ versioned در ریپو | نقش |
|---|---|---|
| `C:\ghasedak-tools\run-backup.cmd` | `infrastructure/backup/scheduled-task/run-backup.cmd` | نقطهٔ ورود task — بدون هیچ non-ASCII؛ `%*` forward می‌کند؛ `%ERRORLEVEL%` را propagate می‌کند |
| `C:\ghasedak-tools\run-backup.ps1` | `infrastructure/backup/scheduled-task/run-backup.ps1` | resolver: مسیر پروژه با اسکن marker `"name": "ghasedak"` در package.json (Unicode-safe با .NET)، node absolute، لاگ UTF8 به `C:\ghasedak-tools\backup-cron.log`، exit code نود = exit wrapper |

آرگومان‌های اختیاری (فقط برای تست): `--Url <conn>` (خالی = primary، هدف job روزانه)، `--Out <dir>` (پیش‌فرض `C:\ghasedak-backups`).

## دو تنظیم Task Scheduler لازم (یک‌بار، با مجوز ادمین انجام شد)

1. **Principal → S4U** (`Run whether user is logged on`, بدون ذخیرهٔ پسورد) — حالت قبلی Interactive بود و خارج از session لاگین اجرا نمی‌شد.
2. **DisallowStartIfOnBatteries=False / StopIfGoingOnBatteries=False** — با تنظیم قبلی، در حالت باتری تسک هرگز شروع نمی‌شد (Queued می‌ماند).

## اثبات (2026-09-26)

- اجرای دستی wrapper: `exit=0`، بکاپ `2026-09-26T00-14-14` با `ok=132/132 rows=652`
- اجرای واقعی از خود Scheduler: `LastTaskResult=0`، بکاپ `2026-09-26T00-31-16` (132/132, 652)
- integrity: sha256/bytes همهٔ 132 فایل مطابق manifest (jsonb چندخطی Outbox خط CSV اضافه دارد — طبیعی)
- fresh restore روی cluster ایزوله (پورت 55434، system_identifier مستقل): deploy baseline + COPY 132/132، 652/652، FK/accounting/inventory/NS سالم
- failure test: مسیر خروجی نامعتبر → `exit=1` + پیام `BACKUP_FAILED` در log (no false-success)

## Retention

هیچ auto-cleanupای در زنجیره وجود ندارد — پاکسازی دستی است؛ risk حذفِ ناخواستهٔ بکاپ معتبر صفر است.
(پیشنهاد آینده، خارج از این گیت: نگهداشت ۱۴ نسخهٔ اخیر مطابق README اصلی.)
