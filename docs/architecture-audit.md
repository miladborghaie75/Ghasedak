# Architecture Audit — قاصدک (ممیزی کامل مخزن، بند ۱۵۴ Master Prompt)

> آخرین ممیزی: ۱۴۰۵/۰۷/۰۳ — بر اساس runtime واقعی (تست ۱۹/۱۹، تایپ‌چک صفر خطا، سه سرور زنده).
> این سند «نقشهٔ ماندگار معماری» است؛ با هر تغییر معماری به‌روزرسانی شود (بند ۵ Master).

## ۱) Architecture / Monorepo Map

| لایه | تکنولوژی | محل | وضعیت |
|---|---|---|---|
| Monorepo | pnpm workspace + Turborepo | `pnpm-workspace.yaml`, `turbo.json` | ✅ DONE |
| Storefront | Next.js 15 + React 19 + Tailwind v4 | `apps/storefront` (:3111) | ✅ DONE |
| Admin | Next.js 15 (RTL، دسکتاپ-فرست) | `apps/admin` (:3200) | ✅ DONE |
| API | NestJS + Prisma 6 | `apps/api` (:4000، prefix `api/v1`) | ✅ DONE |
| DB | PostgreSQL 16 (باینری Zonky، `C:\ghasedak-pg`, :5433) | `packages/database` | ✅ DONE — Docker/Redis روی سیستم نصب نیست |
| Contracts | Money صحیح IRT + ApiError + Pagination | `packages/contracts` | ✅ DONE |
| Utils | cn/format واحد | `packages/utils` | ✅ DONE |
| Git | — | **ریپو git نیست** (`.git` وجود ندارد) — نسخه‌پشتیبان/کنترل نسخه = ریسک | ⚠️ ریسک محیطی |

## ۲) Domain Map (Source-of-Truth Map — بند ۶)

| دامنه | Source of Truth | سرویس | وضعیت |
|---|---|---|---|
| انبار | `StockLedgerEntry` + projection `ProductVariant.stockQty/reservedQty` | `inventory.service.ts` — move/moveInTx اتمیک، `FOR UPDATE`، idempotencyKey، ممنوعیت منفی | ✅ DONE |
| رزرو | `StockReservation` (TTL) | reserve/releaseByRef/consume/releaseExpired | ✅ DONE |
| قیمت | `VariantPrice` سطح کانال (PriceLevel) + fallback روی variant | `orders.service.effectivePrice` — فقط سرور | ✅ DONE |
| سفارش | `Order/OrderItem` با snapshot کامل + OrderStatusHistory | `orders.service` — رزرو اتمیک قبل از ساخت سفارش | ✅ DONE |
| پرداخت | `PaymentAttempt` state machine (CREATED→REDIRECTED→CALLBACK_RECEIVED→VERIFYING→PAID) | `payments.service` — verify فقط سمت سرور، idempotent | ✅ DONE (ZarinPal = NOT CONFIGURED بدون credential؛ mock فقط غیر-production) |
| حسابداری | `JournalEntry/JournalLine` + COA ۸ حسابه | `journal.service` — سند متوازن اجباری + reverse | ✅ DONE |
| خرید | `Supplier/PO/GRN/PurchaseInvoice/AP` | `purchasing.service` — GRN→Ledger+WAC، Three-Way Match، PPV | ✅ DONE |
| POS | `PosInvoice/PosPayment/CashierShift` | `pos.service` — شیفت + پرداخت چندگانه + shared stock | ✅ DONE |
| RMA | `ReturnRequest/Item(condition)/Policy/Refund` | `returns.service` — سیاست بهداشتی، بازشکستن موجودی فقط پس از بازرسی | ✅ DONE |
| ارسال | `Shipment` | `shipping.service` — LABEL/IN_TRANSIT/DELIVERED + رهگیری عمومی | ✅ DONE |
| Event | `DomainEventOutbox` (at-least-once، unique name+payload) | `event-bus.service` — worker هر ۵ث، retry/backoff، FAILED بعد ۵ تلاش | ✅ DONE |
| Audit | `AuditLog` | سراسری در کنترلرهای حساس | ✅ DONE |
| RBAC | `Permission/RolePermission` + PermissionsGuard سراسری (APP_GUARD) | ۱۲۲ endpoint با @RequirePermission | ✅ DONE |
| Media | `Media` (magic-byte validation) | capabilities.controller | ✅ DONE |
| تنظیمات | `Setting` (JSON) + `InventorySetting` (تایپ‌دار) | capabilities + inventory-settings.service | ✅ DONE |

## ۳) API Map (۱۶ ماژول، ~۶۵ کنترلر-فایل)

مسیرها (prefix `/api/v1`): `auth` (login/logout/me) · `admin/products` (CRUD+variant-matrix+pos-search+seo-suggest) · `admin/catalog` (categories/brands/attributes) · `admin` (users/audit/settings/inventory/stocktake/bulk/notifications) · `admin/capabilities` (permissions/me+sms/media/coupons/sales-report/home-sections) · `admin/accounting` (journal/trial-balance/integrity/pnl/monthly/invoices/payroll/entries+reverse) · `admin/inventory-ops` (dashboard/warehouses/ledger/transfers/quarantine/damage/settings/reports/6گانه+approvals) · `admin/purchasing` (suppliers/PO/GRN/invoices/pay) · `admin/public` (theme/motion/home-sections) · `orders` (checkout مهمان + cancel) · `payments` (methods/start/verify/callback/admin-list) · `pos` (shift open/close/current/sale/invoices) · `returns` (request/list/approve/reject/receive/settle) · `shipping` (shipments/label/status/track) · `media/:key` · `health`

## ۴) UI Map

- **Storefront** (موبایل-فرست RTL): home (HeroDrawer کشوی لباس زیر + NeedFinder) · `c/[slug]` فیلتر سایز/سیم/فنجان · `p/[slug]` گالری/واریانت/SizeGuide/RelatedShelf/StickyBuyBar · cart · checkout (مهمان، فیلدهای بند ۱۰۸) · pay (+mock gateway) · paid/failed · order/[code] · wishlist · need · guides · search · sitemap/robots · Header دو ردیفه موبایل مطابق بند ۱۰۳. کامپوننت‌ها: ProductCard (کوییک‌اد + wishlist + برچسب)، QuickAddHost، motion از ادمین. **Single Theme روشن** — توکن‌های `@theme` (palette بند ۴۸)؛ Dark Mode = NOT IMPLEMENTED (بند ۴۹ فقط روشن پیاده شده).
- **Admin** (دسکتاپ): داشبورد · محصولات · دسته‌ها · برندها · ویژگی‌ها · موجودی و انبارگردانی · انبارها · گزارش انبار · خرید · رسانه · POS · سفارش‌ها · پرداخت‌ها · حسابداری · بازاریابی (کد تخفیف + صفحه‌ساز) · کاربران · Audit · تنظیمات + پیامک/درگاه. منوی permission-aware (`lib/menu.ts`).

## ۵) Event/Queue Map
Outbox: OrderCreated، OrderPaid (+SMS صف با credential)، LowStockStockAlert، StockRestocked («موجود شد»)، StocktakeApprovalRequested. Handlerهای idempotent. Queue واقعی (BullMQ/Redis) = NOT CONFIGURED (Redis نصب نیست؛ worker in-process فعلاً کافی).

## ۶) Security Map
helmet + CORS allowlist + rate-limit (login 10/min، checkout 20/min) + httpOnly session (scrypt) + PermissionsGuard سراسری + error filter استاندارد بند ۶۵ + requestId. پوشش‌نشده: 2FA، CSRF توکن صریح، argon2id (scrypt فعلی)، Security Event Engine، WAF — همگی در نقشه فاز AC چک‌لیست.

## ۷) Feature Reconciliation Matrix (خلاصه وضعیت هر حوزه از ۳۰ حوزه سند)

| حوزه | وضعیت | توضیح |
|---|---|---|
| Storefront/Admin/POS/Cart/Checkout/Orders/Payments/Inventory core/Accounting core/RMA/Shipping/Event/Notifications بنیادی | **DONE** | runtime-تست‌شده، تست ۱۹/۱۹ |
| Procurement (Supplier/PO/GRN/WAC/AP/Three-Way/PPV) | **DONE** | تسک انبار؛ UI `/inventory/purchase` |
| Multi-warehouse/Transfer/Quarantine/Damage/Reports انبار/Settings انبار/Approval انبارگردانی | **DONE** | تسک انبار |
| Search | **PARTIAL** — جستجوی SQL + نرمال‌سازی؛ فاز W: Meilisearch/pg_trgm | چک‌لیست ردیف ۱۴ |
| Price History / Channel Publishing کامل | **PARTIAL** — VariantPrice سطح کانال فعال؛ PriceHistory مدل دارد ولی UI تاریخچه ندارد | بند ۱۵ |
| Dark Mode (بند ۴۹–۵۷) | **MISSING** — تک‌تم روشن؛ مستند در globals.css | بزرگ‌ترین شکاف UX |
| Size Finder تعاملی (بند ۴۳) | **PARTIAL** — SizeGuide + NeedFinder هست؛ سنجش زیر‌سینه/سینه گام‌به‌گام نیست | بند ۴۳ |
| Reviews | **PARTIAL** — مدل Review/ReviewStatus؛ UI عمومی حجیم نشده (طبق بند ۱۰۷ درست) | بند ۱۰۷ |
| CRM/Loyalty | **PARTIAL** — CustomerAccount + CreditTransaction مدل؛ UI CRM نیست | چک‌لیست ۱۶/۲۱ |
| Abandoned Cart (بند ۴۰) | **MISSING** — Cart مدل دارد؛ تشخیص رهاشدگی/کمپین نیست | بند ۴۰ |
| Page Builder | **PARTIAL** — HomeSection (صفحه‌ساز اصلی) فعال؛ بیلدر عمومی صفحه (CmsPage) نیست | بند ۷۶ |
| AI Gateway/Tool Registry (بند ۵۸–۶۵) | **MISSING** — فقط seo-suggest داخلی؛ فلگ ai خاموش | فاز AI |
| Integrations/Social/Divar/Torob (بند ۶۶–۷۱) | **MISSING** — SalesChannel/WebhookEvent مدل؛ آداپتور نیست | فاز Z |
| SEO | **DONE (پایه)** — sitemap/robots/OG/SeoMeta/SlugRedirect + seo-suggest؛ schema.org/Product = PARTIAL | بند ۷۲ |
| Offline POS (بند ۲۸) | **MISSING** | بند ۲۸ |
| 2FA/Security Events (بند ۸۸) | **MISSING** | فاز AC |
| Backup/DR (بند ۹۳) | **MISSING** — pg_dump خودکار/تست بازآوری نیست | ریسک بالا (ریپو هم git نیست) |
| Observability (بند ۸۰) | **PARTIAL** — requestId/error log؛ metrics/trace نیست | فاز AC |
| Redis/Storage در Health | **NOT CONFIGURED** — صادقانه degraded (بند ۱۱۱) | سرویس خارجی |
| SMS/پرداخت واقعی | **NOT CONFIGURED** — آداپتور واقعی، بدون credential فعال نمی‌شود | بند ۱۱۱ رعایت شده |

## ۸) ترتیب پیاده‌سازی پیشنهادی (dependency-ordered، بند ۸)

۱. **پایداری**: git init + بکاپ pg_dump زمان‌بندی‌شده + سند DR (ریسک بالای داده‌های واقعی)
۲. **Theme System واقعی Dark/Light/System** (بند ۴۹–۵۷): توکن‌های معنایی + persistence + SSR-safe — اثر متقاطع روی هر دو اپ
۳. **Size Finder تعاملی + Size System** (بند ۴۲–۴۴) — تمایز اصلی محصول
۴. **CRM پایه + Abandoned Cart** (بند ۳۱/۴۰) — مدل‌ها هست، سرویس/UI کم است
۵. **Price History UI + Channel Publishing** (بند ۱۵/۱۰۲)
۶. **Reviews عمومی** (مدل کامل؛ UI با حجم معقول بند ۱۰۷)
۷. **Search فاز W** (pg_trgm → Meilisearch-ready)
۸. **AI Gateway + Tool Registry** (بند ۵۸–۶۵) پس از stabil شدن دامنه‌ها
۹. **Integrations/Social/Offline POS** (فاز Z/بند ۲۸)
۱۰. **سخت‌سازی امنیت** (2FA، CSRF، Security Events — فاز AC)

## ۹) ریسک‌های فعال
1. **بدون git** — هر خرابی دیسک = از دست رفتن کل پلتفرم.
2. **بدون بکاپ خودکار DB** (بند ۹۳ MISSING).
3. Shadow-replay migrationها به‌خاطر drift قدیمی `pos_shift_link` شکست می‌خورد — migration جدید فقط با الگوی diff زنده (مستند در `.freebuff/run.md`).
4. Health همیشه degraded گزارش می‌دهد (redis/storage) — صادقانه ولی برای مانیتورینگ production نیاز به تفکیک has:redis دارد.
