# مرتب‌سازی ساختار Git پس از استقرار — ۲۰۲۶-۱۰-۳۱

## وضعیت قبل

| Ref | کامیت | توضیح |
|---|---|---|
| `main` | `a5edb89` | آخرین نسخهٔ پیش از ممیزی (گام ۴۵) |
| `audit-and-optimization` | `a56fe5d` | فاز ۱ + فاز ۲ + مستند استقرار |
| نسخهٔ مستقرشده روی تولید | `b52054b` | فاز ۲ (کد اجرایی) |

بررسی‌ها:

- `git log main..audit-and-optimization` → سه کامیت: `9c45837`، `b52054b`، `a56fe5d`
- `git log audit-and-optimization..main` → **خالی** (هیچ کامیت یکتایی روی `main` نبود)
- `git diff --stat main audit-and-optimization` → ۲۴ فایل، ۴۹۰ افزوده / ۳۵ حذف — فقط اصلاحات ممیزی و مستندات

نتیجه: ادغام **fast-forward** ممکن بود؛ هیچ Merge Conflict یا از‌دست‌رفتن تغییر وجود نداشت.

## ادغام انجام‌شده

```text
* a56fe5d (main, origin/main, origin/audit-and-optimization) مستند استقرار
* b52054b (tag: deploy-2026-10-30) رفع باگ‌ها و پایدارسازی ← نسخهٔ فعال تولید
* 9c45837 گزارش فاز ۱
* a5edb89 گام ۴۵
```

- `main` با fast-forward به `a56fe5d` رسید و روی GitHub push شد.
- تگ annotated `deploy-2026-10-30` روی `b52054b` ساخته و push شد.
- برنچ `audit-and-optimization` حذف نشده و همان `a56fe5d` است.
- سرور تولید نیز به برنچ `main` در `a56fe5d` منتقل شد؛ **هیچ سرویسی ری‌استارت نشد**.
- تفاوت `b52054b` (کد مستقرشده) با `main` فقط یک فایل مستندات است؛ کد اجرایی دست‌نخورده است.

## بکاپ‌ها (روی سرور)

| مورد | مسیر |
|---|---|
| دیتابیس قبل از استقرار | `/var/backups/ghasedak/predeploy-20261030-220311.dump` |
| build قبلی | `/var/backups/ghasedak/build-20261030-220311.tgz` |
| nginx قبلی | `/var/backups/ghasedak/nginx-20261030-220311.conf` |
| Bundle گیت قبل از ادغام | `/var/backups/ghasedak/ghasedak-premerge-20261030.bundle` |
| نسخهٔ محلی bundle و refها | `.run-local/ghasedak-premerge-20261030.bundle` و `.run-local/premerge-refs.txt` |

## Rollback (در صورت نیاز)

```bash
# بازگشت کد سرور به نسخهٔ پیش از ممیزی (نیازمند rebuild و restart)
git -C /opt/ghasedak checkout a5edb89
# یا بازگشت فقط دیتابیس (پس از توقف نوشتن):
pg_restore -d <DATABASE_URL> /var/backups/ghasedak/predeploy-20261030-220311.dump
```

## Pull Request

در این محیط هیچ کلاینت GitHub احراز‌شده (`gh`) یا توکن API موجود نبود؛ بنابراین PR واقعی روی GitHub ساخته نشد.
متن آمادهٔ PR در `audit/pr-body.md` نگهداری می‌شود و ادغام با fast-forward محلی + push به `main` انجام شد.
از آنجا که `main` و برنچ اکنون هم‌تراز هستند، ساخت PR جدید روی این برنچ دیگر diff ندارد.

## چک‌لیست تأیید

- [x] `main` جدای از برنچ، کامیت یکتا نداشت
- [x] ادغام fast-forward بدون Conflict
- [x] `b52054b` جد `main` است (`git merge-base --is-ancestor`)
- [x] `main` و `audit-and-optimization` هم‌درخت‌اند
- [x] سرور روی `main` است و health/صفحه‌ها/۴۰۴ سالم‌اند
- [x] سرویس‌ها ری‌استارت نشدند (`ExecMainStartTimestamp` بدون تغییر)
