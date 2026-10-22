# Ghasedak — پلتفرم فروشگاه + POS + انبار + حسابداری

پلتفرم یکپارچه فروشگاه اینترنتی «لباس زیر قاصدک»: Storefront + Admin + API روی یک
Source of Truth مشترک (PostgreSQL).

## معماری

```
apps/storefront   ← فروشگاه مشتری (Next.js 15, RTL, :3111)
apps/admin        ← پنل مدیریت (Next.js, RTL, :3200) — فقط از طریق API
apps/api          ← NestJS (:4000) — همه منطق دامنه
packages/database ← Prisma schema + migration + seed (~۸۰ مدل)
packages/contracts← Money صحیح IRT + ApiError + DTO مشترک
packages/utils    ← cn/format
infrastructure/   ← docker-compose (PG+Redis) و اسکریپت‌های PG محلی
docs/             ← ۷ سند معماری + implementation-status.md
```

## اجرای محلی با یک دستور

```bash
bash infrastructure/run-local.sh start   # PG + API + storefront + admin
bash infrastructure/run-local.sh status  # وضعیت سرویس‌ها
bash infrastructure/run-local.sh stop    # خاموشی کامل
```

- پورت‌ها: API ‏4000، storefront ‏3111، admin ‏3200 (قابل بازنویسی با `API_PORT`/`SF_PORT`/`ADMIN_PORT`)
- دیتابیس: پیش‌فرض کلاستر تمرین `:55433/wave1rehearsal3` (اسکیمای هم‌راستا با کد + seed دمو).
  با `GHASEDAK_DB=primary` روی دیتابیس اصلی `:5433/ghasedak` می‌رود — اگر مایگریشن‌های
  جدید اجرا نشده باشند، ReminderService هنگام استارت با خطای `P2022` کرش می‌کند.
- لاگ‌ها و pidها در `.run-local/` (gitignore شده).

### اگر پنل ادمین با رمز باز نشد

پنل ادمین رمز را خودش نمی‌سنجد؛ API این کار را می‌کند. پس اول ببینید کدام سرویس خاموش است:

```bash
bash infrastructure/run-local.sh status   # postgres / API / storefront / admin
```

سه حالت متفاوت (صفحهٔ ورود این‌ها را از هم جدا می‌گوید):

| پیام | علت | کار |
|---|---|---|
| «سرور پنل پاسخ نمی‌دهد» | API یا Postgres خاموش | `bash infrastructure/run-local.sh start` |
| «ایمیل یا رمز نادرست است» | واقعاً ۴۰۱ از API | ایمیل/رمز حساب دمو را چک کن |
| «سرور پنل خطا داد» | API بالا ولی خطای داخلی | `.run-local/api.log` را بخوان |

اگر `status` می‌گوید storefront خاموش است ولی build نداری: `next start` بدون
`next build` بالا نمی‌آید — یا `pnpm --filter @ghasedak/storefront build` بزن، یا در حالت
توسعه `pnpm --filter @ghasedak/storefront dev`.

## پیش‌نیازها

- Node.js ≥ 20 + pnpm (`npx pnpm`)
- PostgreSQL 16 — یکی از دو راه:
  - **Docker:** `docker compose up -d` در ریشه
  - **باینری محلی (بدون نصب):** `infrastructure/pg` — اسکریپت `infrastructure/pg-setup.ps1`

## متغیرهای محیطی

`.env.example` را کپی کنید. حداقل:

| متغیر | مقدار dev |
|---|---|
| `DATABASE_URL` | `postgresql://postgres:ghasedak-dev-pw@localhost:5433/ghasedak` |
| `API_ORIGIN` (ادمین) | `http://localhost:4000` |
| `PORT` (API) | `4000` |

## راه‌اندازی DB و داده اولیه

```bash
cd packages/database
pnpm db:migrate                 # migration کامل شِما (dev)
pnpm db:seed                    # داده DEMO (کاربران/انبار/کانال/قیمت/محصول/COA) — از tsx استفاده می‌کند
```

⚠️ همه داده seed برچسب **DEMO** دارد (بند ۹۶). هیچ بج/مجوز/مودیانی جعل نمی‌شود.

## اجرا (۳ ترمینال یا تک‌زیر)

```bash
npx pnpm --filter @ghasedak/api dev         # → :4000
npx pnpm --filter @ghasedak/admin dev       # → :3200
npx pnpm --filter @ghasedak/storefront dev  # → :3111
```

## حساب‌های توسعه (فقط DEMO)

| نقش | ایمیل | رمز |
|---|---|---|
| مدیر ارشد | `admin@ghasedak.demo` | `Ghasedak#Demo1` |
| حسابدار | `accountant@ghasedak.demo` | `Ghasedak#Demo1` |
| صندوقدار | `cashier@ghasedak.demo` | `Ghasedak#Demo1` |
| انباردار | `inventory@ghasedak.demo` | `Ghasedak#Demo1` |

## فلوی E2E زنده (تست‌شده)

چک‌اوت مهمان → رزرو انبار اتمیک → پرداخت آنلاین (Mock در dev / زرین‌پال با credential) →
verify سمت‌سرور → مصرف رزرو + حرکت SALE در Ledger → سند حسابداری خودکار Dr/Cr →
Event Bus (OrderPaid). هم‌چنین POS کامل با شیفت صندوق و RMA/Shipping runtime.

```bash
# سناریو سریع با curl — بند ۱۱۴ سند Master
curl -X POST :4000/api/v1/orders/checkout -d '{...}'   # → ORD-…
curl -X POST :4000/api/v1/payments/start -d '{...}'    # → redirect درگاه
curl -X POST :4000/api/v1/payments/verify/<authority>   # → PAID
```

جزئیات کامل سناریو در `docs/implementation-status.md`.

## تست

```bash
npx pnpm --filter @ghasedak/api test          # Journal (Dr=Cr, DB واقعی) + RBAC Guard
npx pnpm --filter @ghasedak/storefront test   # لحن/کپی + سایز + مرتب‌سازی امتیاز
```

### تست بصری کارت گرید (نیازمند سرور بالا)

هندسهٔ کارت محصول — هم‌اندازه‌بودن کارت‌های امتیازدار و بی‌امتیاز و هم‌ترازی ردیف
امتیاز و دکمهٔ خرید — در سه عرض (۳۹۰/۷۶۸/۱۲۸۰) و هر دو تم سنجیده می‌شود. اسکریپت
بدون وابستگی بیرونی است (CDP خود Chrome/Edge + WebSocket توکار Node) و کد خروج
غیرصفر یعنی شکست:

```bash
# سرور فروشگاه باید بالا باشد (نکست start/dev)
node apps/storefront/scripts/visual-card-parity.mjs http://127.0.0.1:3111 "/search?q=تست&sort=rating"
BREAK_GEOMETRY=1 node apps/storefront/scripts/visual-card-parity.mjs   # اثبات این‌که شکست را می‌گیرد (باید exit=1)
SELFTEST=1 node apps/storefront/scripts/visual-card-parity.mjs         # همان تزریق با معنای معکوس: گرفتن باگ = موفقیت
SHOTS=1 node apps/storefront/scripts/visual-card-parity.mjs            # ذخیرهٔ اسکرین‌شات هر حالت در .visual/
```

برای اینکه لیست هم کارت امتیازدار داشته باشد و هم بی‌امتیاز (بدون آن، تست معنایش را
از دست می‌دهد و صریحاً FAIL می‌دهد):

```bash
npx pnpm --filter @ghasedak/database db:visual-fixture   # دو محصول در دستهٔ bra؛ یکی با نظر تأییدشده
```

در CI این تست در job مستقل `visual-parity` اجرا می‌شود: پستگرس تازه +
migration + seed دمو + فیکسچر → build و بالا آوردن API و فروشگاه روی همان DB →
اجرای اسکریپت روی `/c/bra?sort=rating`؛ خرابی یعنی کار قرمز، و
اسکرین‌شات‌های هر حالت به‌عنوان artifact ذخیره می‌شوند.

## وضعیت پیاده‌سازی

صادقانه و به‌تفکیک: [`docs/implementation-status.md`](docs/implementation-status.md)
— چه چیزی runtime-تست شده، چه چیزی schema-only است و چه چیزهایی عمداً به فازهای
بعدی بند ۱۰۹ واگذار شده. ادعای «کامل» فقط برای مسیرهای verify-شده.

## امنیت

- ادمین: session httpOnly + هش scrypt (argon2id با افزودن وابستگی native) + RBAC server-side
- helmet headers + rate-limit (login 10/min، checkout 20/min) — brute-force protection
- Money: فقط عدد صحیح تومان، بدون float (`packages/contracts/src/money.ts`)
- پرداخت: callback هرگز تایید نیست؛ فقط verify سمت‌سرور؛ idempotency کامل (سفارش/پرداخت/انبار/سند)
- اعتبارنامه‌های واقعی (زرین‌پال/کاوه‌نگار/Google): **موجود نیستند** — Adapter + Mock آماده، ساختگی ممنوع (بند ۱۱۱)

## مستندات بیشتر

`docs/backend-architecture.md` · `docs/commerce-suite-architecture.md` ·
`docs/platform-architecture.md` · `docs/revision-payment-trust-footer.md` ·
`docs/architecture-v2.md` (فرانت)
