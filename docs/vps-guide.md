# راهنمای عملیات سرور قاصدک (VPS)

> برای **صاحب سایت** نوشته شده — نه توسعه‌دهنده. هر کاری که روی سرور لازم است، علائم خرابی و راه‌حلش همین‌جاست.
> ⚠️ **این فایل عمومی است (ریپوی GitHub). هیچ رمز، کلید یا توکنی را اینجا ننویسید.** رمزها فقط در پنل یا گفت‌وگوی خصوصی.

---

## ۱. نگاه یک‌صفحه‌ای

| چیز | مقدار |
|---|---|
| سرور | `79.127.11.91` — Ubuntu 24.04، ۲ vCPU، ۲گیگ رم (+۴گیگ swap)، ۶۴گیگ دیسک |
| SSH | پورت **6579** (نه 22)، فقط با کلید خصوصی |
| مسیر اپلیکیشن | `/opt/ghasedak` (کاربر سیستمی `ghasedak`) |
| محیط (env) | `/opt/ghasedak/.env` — وضعیت 600؛ رمز دیتابیس و کلیدها همین‌جاست |
| دیتابیس | PostgreSQL محلی، پورت 5432، فقط `127.0.0.1` (از بیرون بسته) |
| سرویس‌ها | `ghasedak-api` (4000) · `ghasedak-storefront` (3111) · `ghasedak-admin` (3200) — هر سه با بوت سرور بالا می‌آیند |
| دامنه‌ها | `www.lebaszirghasedak.ir` (کانونیکال) · `lebaszirghasedak.ir` (۳۰۱ به www) · `admin.lebaszirghasedak.ir` (پنل، noindex) |
| SSL | Let's Encrypt روی هر سه نام، تمدید خودکار (certbot.timer) |
| بکاپ | هر روز ۰۲:۰۰ به `/var/backups/ghasedak` (نگهداری ۱۴ نسخه) + تست بازیابی هر یک‌شنبه ۰۳:۰۰ |
| فایروال | `ufw` فقط 6579/80/443 را باز می‌گذارد — API و پورت‌های Next از بیرون بسته‌اند |
| ابزارهای عملیات | `/root/ghasedak-deploy/` (bootstrap, deploy, backup, restore-test, change-password) |

---

## ۲. اتصال به سرور

**با کلید (روش عادی):**

```bash
ssh -p 6579 -i ~/.ssh/ghasedak_deploy_ed25519 root@79.127.11.91
```

**با PuTTY (ویندوز):** Host Name = `79.127.11.91`، Port = `6579`، Connection type = SSH. سپس
`Connection → SSH → Auth` کلید خصوصی (فرمت `.ppk`) را بدهید. اگر کلید را ندارید، بگویید تا دوباره صادر شود.

**اگر دسترسی گم شد:** رمز root را از پنل آذرآنلاین (مدیریت سرور ← سرویس ← تغییر رمز/دسترسی) ریست کنید؛ بعد از ورود،
کلید دسترسی را دوباره اضافه کنید و رمز را خاموش بگذارید:

```bash
# (فقط بعد از اینکه ورود با کلید را تست کردید!)
install -m 600 /root/.ssh/authorized_keys /root/.ssh/authorized_keys   # مطمئن شوید درست است
# فایل پیکربندی: /etc/ssh/sshd_config.d/00-ghasedak.conf
#   PubkeyAuthentication yes
#   PasswordAuthentication no
#   PermitRootLogin prohibit-password
# بعد: sshd -t && systemctl restart ssh
```

> `fail2ban` روی پورت 6579 فعال است و بعد از ۵ تلاش ناموفق، آی‌پی مهاجم را ۱ ساعت مسدود می‌کند — اگر خودتان قفل شدید،
> از کنسول پنل آذرآنلاین وارد شوید و `fail2ban-client unban <ip>` بزنید.

---

## ۳. کارهایی که فقط شما می‌توانید انجام دهید (چک‌لیست قبل از لانچ)

| # | کار | کجا |
|---|---|---|
| ۱ | **رمز چهار حساب ادمین را عوض کنید** (بخش ۵) | سرور |
| ۲ | Merchant ID زرین‌پال و `ZARINPAL_SANDBOX=false` | پنل ادمین ← سیستم ← پیامک و درگاه پرداخت |
| ۳ | کلید اپراتور پیامک | همان صفحه، کارت پیامک |
| ۴ | SMTP (ایمیل تراکنشی) | همان صفحه، کارت «کلیدهای API» + ری‌استارت API |
| ۵ | ربات تلگرام هشدار (`ALERT_TELEGRAM_BOT_TOKEN` / `CHAT_ID`) | `/opt/ghasedak/.env` سپس ری‌استارت API |
| ۶ | `NEXT_PUBLIC_GA4_MEASUREMENT_ID` + `GA4_API_SECRET` (قبل از build!) | همان env سپس `deploy.sh` |
| ۷ | ورود کاتالوگ واقعی و حذف دادهٔ DEMO (گام ۳۹) | پنل ادمین ← محصولات |
| ۸ | ساخت حساب ادمین با ایمیل واقعی خودتان | پنل ادمین ← کاربران |

> هشدارها بدون توکن تلگرام در حالت **dry-run** فقط لاگ می‌زنند (`component=alerting, status=DRY_RUN`) —
> یعنی تا گام ۵ را انجام ندهید هیچ پیامی به‌دست شما نمی‌رسد.

---

## ۴. به‌روزرسانی سایت (بعد از هر تغییر)

روی سرور:

```bash
bash /root/ghasedak-deploy/deploy.sh
```

همین. اسکریپت به‌ترتیب: pull از GitHub ← نصب وابستگی ← مایگریشن دیتابیس ← seed فقط اگر دیتابیس خالی باشد ←
build (با کش، چند ثانیه) ← ری‌استارت سه سرویس ← بررسی SSL ← هشت تست سلامت. خروجی کامل در
`/root/ghasedak-deploy/deploy.log`.

**خطاهای پرتکرار:**

| پیام | معنی | کار |
|---|---|---|
| `شعبه از origin جلوتر/عقب‌تر است` | روی سرور دستی تغییر داده‌اید | `git -C /opt/ghasedak status` را ببینید؛ اصلاً دستی ویرایش نکنید |
| `health FAIL` در پایان | یکی از سرویس‌ها بالا نیامد | `journalctl -u ghasedak-api -n 50 --no-pager` |
| `prisma: Environment variable not found: DATABASE_URL` | `/opt/ghasedak/.env` خراب/جابه‌جاست | `ls -l /opt/ghasedak/.env` و اولین خطوطش را ببینید |
| `ERR_PNPM_... lockfile` | نسخهٔ pnpm فرق کرده | `corepack prepare pnpm@10.12.1 --activate` |

**تغییر env:** فقط `/opt/ghasedak/.env` را ویرایش کنید، بعد حتماً `deploy.sh` (یا دستی `systemctl restart ghasedak-api`) —
متغیرهای `NEXT_PUBLIC_*` فقط با **build دوباره** اعمال می‌شوند.

---

## ۵. تغییر رمز حساب‌های ادمین

پنل ادمین فعلاً فرایند «فراموشی رمز» را فقط با کانال ایمیل/پیامک تنظیم‌شده کار می‌کند؛ تا قبل از تنظیم SMTP، رمز را
**از روی سرور** عوض کنید:

```bash
bash /root/ghasedak-deploy/change-password.sh admin@ghasedak.demo 'رمز-تازه-شما'
```

- همان پارامترهای argon2 برنامه را استفاده می‌کند، پس فوراً در پنل کار می‌کند.
- رمز نباید شامل `'` باشد.
- برای هر چهار حساب (`admin@`، `accountant@`، `cashier@`، `inventory@ghasedak.demo`) تکرار کنید.

**رمز فعلی چهار حساب DEMO در پیام گفت‌وگوی خصوصی به شما داده شده و عمداً در هیچ فایلی ذخیره نشده است.**
بعد از ساخت حساب ادمین واقعی (گام بالا)، این چهار حساب DEMO را غیرفعال یا حذف کنید.

---

## ۶. بکاپ و بازیابی

**خودکار:** هر روز ساعت ۰۲:۰۰ بکاپ گرفته می‌شود (`/var/backups/ghasedak/<زمان>/` شامل `data/*.csv`،
`manifest.json` با sha256 و `verify.json` تأییدشده) و ۱۴ نسخهٔ آخر نگه داشته می‌شود. هر یک‌شنبه ساعت ۰۳:۰۰
**تست بازیابی** روی یک دیتابیس موقت اجرا می‌شود و نتیجه در `restore-test.log` می‌ماند.

**چک دستی:**

```bash
ls -lt /var/backups/ghasedak | head          # آخرین بکاپ کی بود؟
tail -5 /var/backups/ghasedak/backup.log     # آخرین اجرا سبز بود؟
cat /var/backups/ghasedak/<پوشه>/verify.json # "ok": true ؟
```

**بکاپ دستی فوری:** `bash /root/ghasedak-deploy/backup.sh`

**بازیابی کامل روی سرور جدید:**

1. `bootstrap.sh` را بزنید (پکیج‌ها، DB، env).
2. فایل‌های `data/*.csv` و `manifest.json` بکاپ را کپی کنید.
3. از `ghasedak-restore-test.mjs --keep` استفاده کنید تا ساختار + مایگریشن + داده روی DB موقت بنشیند و countها مقایسه شود؛
   بعد محتوا را به `ghasedak` اصلی منتقل کنید.
4. `deploy.sh` و سپس ری‌استارت.

**هشدار مرتبط:** اگر `verify.json` کنار manifest نباشد، HealthWatch هشدار `BACKUP_FAILED` می‌دهد — یعنی بکاپ گرفته شده
ولی verify اجرا نشده (لاگ `backup.log` را ببینید).

---

## ۷. وضعیت و لاگ‌ها

```bash
systemctl status ghasedak-api ghasedak-storefront ghasedak-admin   # سه سرویس
journalctl -u ghasedak-api -f                                      # لاگ زندهٔ API
journalctl -u ghasedak-api --since "-30 min" --no-pager            # نیم‌ساعت اخیر
curl -s http://127.0.0.1:4000/api/v1/health                        # سلامت + دیتابیس
free -h; df -h /; uptime                                           # رم، دیسک، بار
ufw status; fail2ban-client status sshd                            # فایروال و بن‌ها
certbot certificates                                               # اعتبار SSL
```

`health` خوب وقتی است که `status: "ok"` و `checks.db: true` باشد. `redis: false` طبیعی است (استفاده نمی‌شود).

---

## ۸. مشکلات رایج و راه‌حل

| علامت | احتمال | راه‌حل |
|---|---|---|
| سایت باز نمی‌شود / 502 | سرویسی ایستاده | `systemctl status ghasedak-storefront` سپس `systemctl restart ghasedak-storefront` |
| سایت باز است ولی محصولات نیست | API پایین است یا `API_ORIGIN` اشتباه | `curl -s http://127.0.0.1:4000/api/v1/health` و `journalctl -u ghasedak-api` |
| صفحهٔ خالی/خطای 500 بعد از تغییر env | env خراب است | `bash -n` نمی‌شود؛ اولین خطوط `.env` را ببینید، بعد `systemctl restart ghasedak-api` |
| SSL منقضی/هشدار مرورگر | تمدید اجرا نشده | `systemctl status certbot.timer` و `certbot renew --dry-run` |
| خطای OOM هنگام build | رم کم | swap باید فعال باشد: `swapon --show`؛ سپس `deploy.sh` را دوباره بزنید |
| دیسک پر | رسانه/بکاپ/لاگ | `du -sh /opt/ghasedak/apps/data/media /var/backups/ghasedak /var/log` و `journalctl --vacuum-size=200M` |
| آپلود تصویر خطا می‌دهد | پوشهٔ رسانه مالک ندارد | `chown -R ghasedak:ghasedak /opt/ghasedak/apps/data` |
| ورود ادمین رد می‌شود | رمز عوض شده/اشتباه | بخش ۵؛ یا `change-password.sh` |
| سایت از بیرون باز نمی‌شود ولی داخل سرور هست | فایروال/DNS | `ufw status`؛ `nslookup www.lebaszirghasedak.ir` باید `79.127.11.91` باشد |
| پورت 22 باز نیست | عمدی است — پورت 6579 | `ssh -p 6579 ...` |
| پیامک/ایمیل ارسال نمی‌شود | کلید ذخیره نشده یا API ری‌استارت نشده | پنل ← پیامک و درگاه پرداخت؛ بعد `systemctl restart ghasedak-api` |
| درگاه پرداخت «فعال نیست» | Merchant ثبت نشده/هنوز sandbox | بخش ۳ ردیف ۲ |
| cron کار نکرد | سرویس cron خاموش | `systemctl status cron` و `grep ghasedak /var/log/syslog` |
| قفل SSH روی خودتان | fail2ban | کنسول آذرآنلاین ← `fail2ban-client unban <ip>` |

---

## ۹. امنیت — چه چیزی روشن است و چه چیزی باقی است

**انجام‌شده:**

- ورود SSH فقط با کلید؛ رمز root غیرفعال و با تست تأیید شده.
- `ufw`: فقط 6579/80/443؛ API (4000)، فروشگاه (3111)، ادمین (3200) و PostgreSQL (5432) از بیرون بسته.
- `fail2ban` روی پورت SSH.
- HSTS روی هر دو دامنه، ریدایرکت ۳۰۱ apex→www، پنل با `X-Robots-Tag: noindex`.
- کوکی نشست با `httpOnly` + `sameSite=lax` + `secure` (چون `NODE_ENV=production`).
- `/admin/diagnostics` بدون توکن 401 می‌دهد؛ رمزهای seed اولیه عوض شد.

**باقی‌مانده (به ترتیب اهمیت):**

1. رمز چهار حساب DEMO را عوض/حذف کنید و حساب واقعی بسازید.
2. کلیدهای درگاه/پیامک/SMTP را وارد کنید و `ZARINPAL_SANDBOX=false` را فقط بعد از تست واقعی بگذارید.
3. توکن تلگرام هشدار را ست کنید تا هشدارهای مانیتورینگ واقعاً برسند (گام ۳۸-۱).
4. پشتیبان‌گیری را **بیرون از همین سرور** هم داشته باشید (مثلاً دانلود هفتگی یک نسخه) — الان همهٔ بکاپ‌ها روی خودِ سرورند.
5. DNSSEC برای دامنهٔ `.ir` فعلاً متوقف است (NS با آروان؛ انتشار DS نزد ایرنیک تأیید نشده).

---

## ۱۰. بازیابی از صفر (اگر سرور از بین رفت)

```bash
# 1) سرور جدید از پنل آذرآنلاین + اسکریپت‌های deploy از ریپو
git clone https://github.com/miladborghaie75/Ghasedak.git /root/repo && cd /root/repo
bash infrastructure/deploy/server/bootstrap.sh

# 2) ابزار بکاپ (pg + pg-copy-streams) — یک‌بار
mkdir -p /opt/ghasedak-tools/pg-client && cd /opt/ghasedak-tools/pg-client && npm init -y && npm i pg pg-copy-streams

# 3) کد + بیلد + سرویس‌ها + SSL
bash infrastructure/deploy/server/deploy.sh

# 4) بازیابی داده از آخرین بکاپ (بخش ۶)
bash /root/ghasedak-deploy/restore-test.sh --keep   # یا فرآیند دستی بخش ۶

# 5) DNS: A رکورد @ و www و admin → IP جدید در پنل آروان
```
