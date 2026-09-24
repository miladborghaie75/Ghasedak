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
npx prisma migrate dev          # migration کامل شِما
npx tsx scripts/seed.ts         # داده DEMO (کاربران/انبار/کانال/قیمت/محصول/COA)
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
npx pnpm --filter @ghasedak/api test   # Journal (Dr=Cr, DB واقعی) + RBAC Guard
```

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
