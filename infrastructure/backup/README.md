# پشتیبان‌گیری و بازیابی قاصدک — Phase 1 (بند ۹۳ Master)

## چرا pg_dump نیست؟
توزیع PostgreSQL محلی (`C:\ghasedak-pg`، باینری Zonky/embedded) فقط سرویس‌دار است
(`initdb/pg_ctl/postgres`) و **ابزارهای کلاینت (pg_dump/psql/pg_restore) ندارد**؛
PostgreSQL کامل هم روی سیستم نصب نیست و pnpm/npm در ریپو با پروتکل `workspace:*` سازگار نیست.
راه‌حل واقعی (نه فیک): بکاپ منطقی با SQL استاندارد `COPY ... TO/FROM STDIN` از طریق کتابخانه `pg`
که **دقیقاً همان داده‌ای را می‌خواند که pg_dump می‌خواند**.

## پیش‌نیاز (یک‌بار، خارج از ریپو)
```bash
mkdir -p C:/ghasedak-tools/pg-client && cd C:/ghasedak-tools/pg-client
npm init -y && npm install pg pg-copy-streams
```
(این ابزار dependency پروژه نیست؛ در `node_modules` ریپو دست نمی‌زند.)

## بکاپ
```bash
cd infrastructure/backup
NODE_PATH=C:/ghasedak-tools/pg-client/node_modules node ghasedak-backup.mjs
# خروجی: C:/ghasedak-backups/<stamp>/data/*.csv + manifest.json + backup.log
```
- هر جدول: COUNT واقعی + بایت + sha256 در manifest.
- کد خروج: 0 = کامل، 2 = partial (جدولی خطا داشت)، 1 = شکست.

## تست بازیابی (اثبات واقعی)
```bash
cd infrastructure/backup
NODE_PATH=C:/ghasedak-tools/pg-client/node_modules node ghasedak-restore-test.mjs --backup C:/ghasedak-backups/<stamp>
```
- DB موقت جداگانه می‌سازد، **همان migrationهای ریپو** را با `prisma migrate deploy` روی آن اجرا می‌کند
  (structure از منبع حقیقت ریپو)، سپس داده CSV را با `COPY FROM STDIN` برمی‌گرداند
  و COUNT هر جدول را با manifest مقایسه می‌کند.
- با `--keep` می‌توان DB موقت را برای بررسی دستی نگه داشت (پیش‌فرض: حذف خودکار).

## بازیابی واقعی به ghasedak (فاجعه)
```bash
# 1) دیتابیس خالی بساز، 2) migrationها را روی آن اجرا کن، 3) CSVها را COPY کن:
psql-معادل: برای هر جدول؛ اسکریپت restore-test همین را انجام می‌دهد —
فقط URL مقصد را به دیتابیس اصلی بده و از حالت --keep استفاده نکن.
```
توصیه: بازیابی همیشه روی DB تازه + `migrate deploy`، نه روی DB آسیب‌دیده.

## نگهداشت پیشنهادی
- بکاپ روزانه 02:00 با Task Scheduler ویندوز (دستور بالا) + نگهداشت ۱۴ نسخه.
- هر بکاپ، **همان روز** با restore-test تایید شود؛ بکاپ بدون تست بازیابی = بکاپ آزمایش‌نشده.
- نسخه‌های هفتگی را خارج از دیسک سیستم (درایو دیگر/اورکلاد) نگه دار.
