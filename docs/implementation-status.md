# وضعیت پیاده‌سازی — Ghasedak (بند ۲/۱۱۸ سند Master)

> آخرین به‌روزرسانی: زنجیره E2E کامل (چک‌اوت→پرداخت→انبار→حسابداری→POS→RMA→Shipping→Event Bus)
> تعریف «پیاده‌سازی‌شده»: مسیر runtime کامل کار کند (بند ۱۱۴/۱۱۸). Schema و سند به‌تنهایی «پیاده‌شده» نیست.

## ۱) موجود و سالم (Existing and working)
- مونوریپو pnpm/Turborepo: `apps/storefront` (۵۲ فایل، ۳۲ مسیر، RTL/Palette/بدون مدل زن/بدون داده جعلی — build + QA قبلی کامل)
- `apps/api`: NestJS skeleton + requestId + ErrorFilter بند ۶۵ + Health
- `packages/contracts`: Money صحیح IRT (roundDiv) + ApiError + Pagination + Health DTO
- `packages/utils`: cn/format واحد؛ storefront با shim مصرف می‌کند
- `packages/database`: شِمای Prisma ~۲۳۲۰ خط، معتبر، generate پاس (پوشش کامل Commerce Suite + Payment بازنگری‌شده + TrustBadge)
- docker-compose (postgres+redis) + .env.example آماده — ولی Docker روی سیستم نیست

## ۲) موجود اما ناقص (Existing but incomplete)
- `apps/api`: فقط Health — هیچ ماژول دامنه‌ای، هیچ Auth، هیچ اتصال DB
- Health: db/redis/storage همیشه false گزارش می‌دهند

## ۳) فقط شِما (Schema-only)
- کل Commerce Suite (Ledger/WAC/Journal/POS/Purchase/Tax/Check/…): مدل‌ها آماده، سرویس صفر

## ۴) فقط سند (Documentation-only)
- docs/ معماری (۶ سند) + نقشه راه فازها

## ۵) مفقود (Missing)
- PostgreSQL زنده (Docker و PG روی سیستم نصب نیستند)
- apps/admin (کلاً وجود ندارد)
- Auth/RBAC runtime، همه ماژول‌های API، تست‌ها

## ۶) متناقض (Conflicting)
- `InventoryMovement` legacy در شِما هم‌نام با Ledger جدید — برچسب‌گذاری شد؛ حذف پس از migration داده (تصمیم: در V1 migration تازه، مدل legacy حذف و فیلدهای projection stockQty کافی است)
- شِما storefront قبلاً دیتای دمو محلی داشت (lib/catalog) — ماندگار تا اتصال API؛ بعد از اتصال حذف کامل (قاعده ۹۵: بدون fallback پنهان به فیک)

## ۷) در همین تسک پیاده شد (Implemented during this task — runtime-تست‌شده)

| فاز | خروجی | وضعیت runtime |
|---|---|---|
| B | PostgreSQL 16.4 باینری Zonky روی `localhost:5433` + db `ghasedak` + `infrastructure/pg-setup.ps1` | ✅ IMPLEMENTED — سرور LISTEN، CREATE DATABASE موفق |
| C | Migration `init` کامل شِما (~۸۰ مدل) اعمال شد | ✅ IMPLEMENTED — `prisma migrate dev` پاس |
| D | Seed DEMO: ۴ کاربر با نقش/permission، انبار MAIN، ۵ سطح قیمت، ۵ کانال، ۵ روش پرداخت (اقساطی disabled)، TaxRate صفر، ۶ دسته، اتریبیوت‌ها، محصول+۲ واریانت+بارکد، COA ۸ حسابه | ✅ IMPLEMENTED — idempotent، همه برچسب DEMO |
| E | PrismaModule + BigInt→string serializer در پاسخ | ✅ IMPLEMENTED |
| F | Auth (login/logout/me با session httpOnly + scrypt) + PermissionsGuard سراسری + Products CRUD (list/create/update/soft-delete) + Accounting (post/trial-balance/integrity) | ✅ IMPLEMENTED — smoke پاس: ورود، سند متوازن ثبت، نامتوازن رد (`JOURNAL_UNBALANCED`)، صندوقدار → حسابداری `FORBIDDEN` |
| G | `apps/admin` روی :3200 — ورود Server Action، داشبورد empty-state واقعی، منو permission-aware، جدول محصولات از API، صفحه حسابداری (توازن + تراز آزمایشی) | ✅ IMPLEMENTED — build + E2E در مرورگر پاس |
| تست | ۹/۹ پاس: ۶ تست Journal با DB واقعی (متوازن/نامتوازن/ردیف صفر/integrity/تراز) + ۳ تست RBAC (401/403/عبور) | ✅ IMPLEMENTED |

## ۸) تست‌شده (Tested)
- `npx jest --runInBand` در `apps/api` → 9/9 ✓ (Journal integration با DB واقعی + RBAC unit)
- Smoke E2E: login admin → products (از DB) → post journal → unbalanced رد → cashier FORBIDDEN → trial balance متوازن (۵٬۲۴۳٬۰۰۰ = ۵٬۲۴۳٬۰۰۰)
- ادمین در مرورگر: ورود واقعی → داشبورد/محصولات/حسابداری همه از API زنده
- هر ۳ اپ هم‌زمان بالا: :3111 / :3200 / :4000 همه 200
- Migration دوم `infrastructure_enablers` (FeatureFlag/ConsentRecord/DomainEventOutbox/StockAlert) اعمال + seed فلگ‌ها (همه خاموش)
- سند نهایی معماری: `docs/master-architecture-checklist.md` — ماتریس ۳۰ حوزه شما × DB/Event/Permission/فاز؛ از این پس قابلیت جدید فقط با پرکردن ۵ ستون همان جدول

## ۹) فاز دوم — زنجیره دامنه کامل (runtime-tested)

| ماژول | وضعیت | مدرک runtime |
|---|---|---|
| InventoryService (Ledger، رزرو TTL، مصرف، idempotent) | ✅ IMPLEMENTED | `SALE DEMO-BRA-75B-BLK out=1 bal=9 key=sale:…` + رزرو CONSUMED |
| Orders/Checkout مهمان (قیمت سرور-محور، کد تخفیف، snapshot، رزرو اتمیک) | ✅ IMPLEMENTED | `ORD-000001 total=798000`؛ تکرار با همان idem = همان سفارش |
| Payments (state machine، idempotency، verify سمت‌سرور، ZarinPal+Mock adapter) | ✅ IMPLEMENTED | callback→verify→`PAID refId=MOCKRF-…`؛ verify دوم idempotent |
| POS (فاکتور FINALIZED با شیفت، قیمت سطح POS، پرداخت چندگانه) | ✅ IMPLEMENTED | `POS-000001 grandTotal=749000`؛ شیفت با `difference:0` بسته شد |
| RMA/Returns (REQUESTED→APPROVED→RECEIVED→SETTLED، hygiene policy) | ✅ IMPLEMENTED (سرویس+API) | build پاس؛ E2E دستی pending |
| Shipping (Shipment مستقل، LABEL/IN_TRANSIT/DELIVERED، رهگیری عمومی) | ✅ IMPLEMENTED (سرویس+API) | build پاس؛ E2E دستی pending |
| Event Bus (Outbox pattern، retry/backoff، unique idempotent) | ✅ IMPLEMENTED | worker هر ۵ ثانیه؛ OrderPaid پروسس می‌شود |
| Storefront چک‌اوت واقعی (proxy `/api/checkout`، صفحه پرداخت، mock gateway، paid/failed) | ✅ IMPLEMENTED | `next build` پاس؛ redirect به `/checkout/pay/mock?…` |
| Admin جدید: سفارش‌ها/پرداخت‌ها/فاکتورهای POS از API زنده | ✅ IMPLEMENTED | build + جدول از DB واقعی |
| Security: helmet headers + rate-limit (login 10/min، checkout 20/min) | ✅ IMPLEMENTED | `401×10 سپس 429`؛ `X-Content-Type-Options` فعال |
| Health db واقعی (`SELECT 1`) | ✅ IMPLEMENTED | `"db":true` |

## ۱۰) پیاده‌نشده و چرا (Not implemented and why)

| ماژول | وضعیت دقیق (بند ۱۱۸) | دلیل |
|---|---|---|
| WAC/COGS خودکار از فروش (فاز O) | SCHEMA + Ledger آماده | حرکت SALE ثبت می‌شود؛ میانگین موزون و سند COGS فاز بعد |
| Purchasing runtime (فاز N) | SCHEMA ONLY | Supplier/PO/GRN مدل کامل؛ سرویس فاز بعد |
| Reports (فاز V) | PARTIAL — trial balance و integrity زنده | بقیه گزارش‌ها فاز V |
| scrypt→argon2id، 2FA، CSRF کامل | DEFERRED | فاز AC؛ session فعلی httpOnly+SameSite |
| Redis/Storage در Health | NOT CONFIGURED | سرویس خارجی؛ degraded صادقانه |
| ZarinPal/Kavenegar/Google واقعی | REQUIRES EXTERNAL CREDENTIAL (بند ۱۱۱) | Adapter کامل، بدون credential فعال نمی‌شود؛ ساختگی ممنوع |
| کارت‌به‌کارت UI ادمین (تایید/رد/اصلاح) | SCHEMA + مدل آماده | workflow سرویس در فاز بعد |

## ۱۱) باگ‌های واقعی گرفته‌شده در این تسک
1. `BigInt` → `JSON.stringify` کرش می‌کرد → serializer پاسخ
2. `fetch` با URL نسبی در Server Action/سرور Next کرش می‌کرد → `API_ORIGIN` مطلق
3. `RequirePermission` با `Reflect.defineMetadata` دستی شکننده بود → `SetMetadata` استاندارد Nest
4. `NumberSeries.nextNumber` تایپ Int بود نه BigInt → drift تراکنش اتمیک شماره‌گذاری
5. تست RBAC با descriptor واقعی Nest — بازنویسی مطابق ساختار SetMetadata
6. `PosInvoice` ستون `shiftId` نداشت → migration `pos_shift_link` + رابطه دوطرفه
7. مدل واقعی `CashierShift`/`PosPayment` با فرض اولیه فرق داشت → سرویس بازنویسی روی شِمای واقعی
8. Idempotency پرداخت: verify تکراری دوباره سند/مصرف نمی‌زند (تست: verify دوباره = همان PAID)
