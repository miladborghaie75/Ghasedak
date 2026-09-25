# Architecture Audit — قاصدک (ممیزی کامل مخزن، بند ۱۵۴ Master Prompt)

> آخرین ممیزی: ۱۴۰۵/۰۷/۰۳ — بر اساس runtime واقعی (تست ۳۸/۳۸ در ۶ suite، تایپ‌چک صفر خطا، سرورهای API/Admin زنده).
> این سند «نقشهٔ ماندگار معماری» است؛ با هر تغییر معماری به‌روزرسانی شود (بند ۵ Master).
>
> **به‌روزرسانی ۴ فاز (۱۴۰۵/۰۷/۰۳):**
> - Phase 1 (commit 41144f6): git baseline + بکاپ منطقی واقعی (COPY CSV) + restore-test تأییدشده + Task Scheduler روزانه 02:00 — بند ۹۳ از MISSING به **DONE (پایه)** رسید.
> - Phase 2 (commit 9863afe): Theme System واقعی Day/Night/System توکن‌محور در هر دو اپ + ۲۲۸ رنگ هاردکد → توکن معنایی + audit کنتراست AA — بند ۴۹–۵۷ از MISSING به **DONE** رسید.
> - Phase 3 (commit 79b9abc): Size System لایه‌مند (سایزچارت + قواعد برند/مدل + sister size) + Size Finder سه‌گامی تعاملی متصل به VariantMatrix + ۸/۸ تست — بند ۴۲/۴۳ از PARTIAL به **DONE (پایه)** رسید.
> - Phase 4 (commit 87c0718): CRM (پروفایل + sync آمار از Orders) + Abandoned Cart زنده از Cart + تنظیمات با audit + Consent عمومی — بند ۳۱/۴۰ از PARTIAL/MISSING به **DONE (پایه)** رسید.
> - Phase 5 (پیش از این): Git remote (github.com/miladborghaie75/Ghasedak) + push snapshot + **Price History/Channel-aware Pricing** (PricingService واحد + PriceHistory ledger + public quote/feed) — بند ۱۵ به **DONE (پایه)** رسید.
> - Phase 6 — Purchase Invoice Professional (بند ۲۷/۳۳/۳۴): میزکار فاکتور خرید اختصاصی + ProductPicker مشترک + QuickCreate + جزئیات حرفه‌ای + GRNI؛ Procurement UI از PARTIAL به **DONE (پایه)** رسید.
> - Phase 6 closure (commit فعلی): (۱) آپلود پیوست مستقیم در میزکار و صفحه جزئیات فاکتور — همان endpoint رسانه `POST /admin/capabilities/media` (mime/magic/10MB) + attach با audit؛ رفع باگ URL پیوست (`mediaId` ≠ `storageKey` → detail حالا `mediaKey` می‌دهد و لینک `/api/media/:storageKey` واقعاً سرو می‌شود). (۲) چاپ حرفه‌ای A4 (`@media print` در globals.css: پالت روشن اجباری، حذف سایدبار/فرم‌ها، جدول بدون شکست، سربرگ اختصاصی سند + امضا) + بارکد وکتور بدون وابستگی (`components/print/Barcode.tsx`: Code39 شماره سند، EAN-13 هر ردیف). (۳) یکسان‌سازی کامل مسیر قیمت: `admin/inventory/bulk-price` حالا از `PricingService.changePrice` می‌گذرد (PriceHistory + رویداد PriceChanged همیشه)، بدون levelId → سطح صریح **BASE** (seed شد) با آینه `productVariant.price`، mode `fixed` → `delta`، مجوز `inventory.adjust|pricing.manage` + reason — ریسک ۷ بسته شد. (۴) RBAC پیوست‌ها با مجوز جایگزین `media.manage`.
> - چاپ برچسب بارکد (بند ۲۸/۱۱۶): `/inventory/labels` — انتخاب واریانت از picker مشترک، لیبل EAN-13 وکتور (کامپوننت موجود Barcode)، قالب رول حرارتی ۵۰×۳۰مم و A4 آستریک ۳×۸ با @page پویا، تعداد کپی per-variant؛ بدون endpoint جدید.
> - تحویل فاکتور خرید به تامین‌کننده (بند ۲۷+۱۱۱): مدل `SupplierInvoiceDelivery` (QUEUED/SENT/FAILED + attempts + lastError) + فیلد `Supplier.email` + `VendorNotifyService` — EMAIL با SMTP واقعی fetch-based (env: SMTP_HOST/USER/PASS/PORT/FROM؛ بدون پکیج جدید)، SMS با آداپتور موجود Kavenegar. مسیر خودکار: رویداد `PurchaseInvoiceCreated` + تنظیم per-scope `purchasing.autoSendInvoiceEmail/Sms` (idempotent per invoice+channel)؛ مسیر دستی: دکمه ✉️/📱 در تب فاکتور + `GET deliveries` تاریخچه. بدون credential ردیف QUEUED می‌ماند و پیام صریح — هیچ «ارسال شد» جعل نمی‌شود. تست ۴/۴ vendor-notify (۴۲/۴۲ کل).
> - ریسک باقی‌مانده: نگهداشت بکاپ فقط محلی است (نسخه خارج از دیسک توصیه شده در README بکاپ).

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
| ProductPicker/QuickCreate (بند ۲۷/۳۳/۳۴) | `/admin/products/picker` + کامپوننت مشترک `components/commerce/ProductPicker` | `products.service.pickerSearch` + QuickCreate (محصول/دسته/برند) | ✅ DONE |
| چاپ برچسب بارکد (بند ۲۸/۱۱۶) | `/inventory/labels` + `components/print/Barcode` | همان picker مشترک + EAN-13 وکتور؛ رول ۵۰×۳۰/A4 ۳×۸، @page پویا | ✅ DONE |
| POS | `PosInvoice/PosPayment/CashierShift` | `pos.service` — شیفت + پرداخت چندگانه + shared stock | ✅ DONE |
| RMA | `ReturnRequest/Item(condition)/Policy/Refund` | `returns.service` — سیاست بهداشتی، بازشکستن موجودی فقط پس از بازرسی | ✅ DONE |
| ارسال | `Shipment` | `shipping.service` — LABEL/IN_TRANSIT/DELIVERED + رهگیری عمومی | ✅ DONE |
| Event | `DomainEventOutbox` (at-least-once، unique name+payload) | `event-bus.service` — worker هر ۵ث، retry/backoff، FAILED بعد ۵ تلاش | ✅ DONE |
| Audit | `AuditLog` | سراسری در کنترلرهای حساس | ✅ DONE |
| RBAC | `Permission/RolePermission` + PermissionsGuard سراسری (APP_GUARD) | ۱۲۲ endpoint با @RequirePermission | ✅ DONE |
| Media | `Media` (magic-byte validation) | capabilities.controller | ✅ DONE |
| تنظیمات | `Setting` (JSON) + `InventorySetting` (تایپ‌دار) | capabilities + inventory-settings.service | ✅ DONE |
| تحویل فاکتور به تامین‌کننده (بند ۲۷+۱۱۱) | `SupplierInvoiceDelivery` + `Supplier.email` | `vendor-notify.service` — EMAIL (SMTP fetch) / SMS (Kavenegar)؛ خودکار با رویداد + دستی از UI؛ بدون credential = QUEUED صریح | ✅ DONE (پایه) |

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
| Procurement (Supplier/PO/GRN/WAC/AP/Three-Way/PPV) | **DONE (پایه حرفه‌ای) — Phase 6 بسته شد**: میزکار فاکتور اختصاصی `/inventory/purchase/invoices/new` + جزئیات `/invoices/[id]` (snapshot/payments/AP/اثر انبار+حسابداری/audit/چاپ حرفه‌ای A4 + بارکد) + ProductPicker مشترک + QuickCreate + GRNI 2150 + **پیوست مستقیم در میزکار/جزئیات** (endpoint رسانه مشترک + attach/detach با audit و mediaKey درست) | Phase 6 + closure |
| Multi-warehouse/Transfer/Quarantine/Damage/Reports انبار/Settings انبار/Approval انبارگردانی | **DONE** | تسک انبار |
| Search | **PARTIAL** — جستجوی SQL + نرمال‌سازی؛ فاز W: Meilisearch/pg_trgm | چک‌لیست ردیف ۱۴ |
| Price History / Channel Publishing کامل | **DONE (پایه)** — VariantPrice سطح کانال + PriceHistory ledger + UI تاریخچه در Pricing + **همه مسیرهای نوشتن قیمت واحد شدند** (bulk-price انبار هم از PricingService.changePrice می‌گذرد — سطح BASE = قیمت پایه، ریسک ۷ بسته) | بند ۱۵ / Phase 5+6 |
| Dark Mode (بند ۴۹–۵۷) | **DONE** — توکن‌محور، سه حالت، persistence، contrast AA (audit ۲۵ نمونه) | Phase 2 |
| Size Finder تعاملی (بند ۴۳) | **DONE (پایه)** — سه گام + سایزچارت + قواعد برند/مدل + sister size + اتصال به انتخابگر | Phase 3 |
| Reviews | **PARTIAL** — مدل Review/ReviewStatus؛ UI عمومی حجیم نشده (طبق بند ۱۰۷ درست) | بند ۱۰۷ |
| CRM/Loyalty | **DONE (پایه CRM)** — پروفایل/تاریخچه/مسدودسازی + sync آمار؛ Loyalty ledger همچنان آینده | Phase 4 |
| Abandoned Cart (بند ۴۰) | **DONE (پایه)** — تشخیص زنده از Cart + تنظیمات + consent؛ پیام‌رسانی = NOT CONFIGURED بدون credential SMS | Phase 4 |
| Page Builder | **PARTIAL** — HomeSection (صفحه‌ساز اصلی) فعال؛ بیلدر عمومی صفحه (CmsPage) نیست | بند ۷۶ |
| AI Gateway/Tool Registry (بند ۵۸–۶۵) | **MISSING** — فقط seo-suggest داخلی؛ فلگ ai خاموش | فاز AI |
| Integrations/Social/Divar/Torob (بند ۶۶–۷۱) | **MISSING** — SalesChannel/WebhookEvent مدل؛ آداپتور نیست | فاز Z |
| SEO | **DONE (پایه)** — sitemap/robots/OG/SeoMeta/SlugRedirect + seo-suggest؛ schema.org/Product = PARTIAL | بند ۷۲ |
| Offline POS (بند ۲۸) | **MISSING** | بند ۲۸ |
| 2FA/Security Events (بند ۸۸) | **MISSING** | فاز AC |
| Backup/DR (بند ۹۳) | **DONE (پایه)** — بکاپ منطقی واقعی (COPY CSV + manifest/sha256) + restore-test تأییدشده (۱۳۱/۱۳۱ + FK canary) + cron روزانه؛ نگهداشت خارج از دیسک = توصیه باز | Phase 1 |
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
1. ~~بدون git~~ → **حل شد** (baseline 46ca8e5 + ۴ commit فازها؛ remote هنوز ندارد — push به remote توصیه می‌شود).
2. ~~بدون بکاپ خودکار DB~~ → **حل شد** (cron روزانه 02:00 + restore-test). نگهداشت نسخه خارج از دیسک هنوز دستی است.
3. Shadow-replay migrationها به‌خاطر drift قدیمی `pos_shift_link` شکست می‌خورد — migration جدید فقط با الگوی diff زنده (مستند در `.freebuff/run.md` و اسکریپت restore از `migrate diff --from-empty` استفاده می‌کند).
4. Health همیشه degraded گزارش می‌دهد (redis/storage) — صادقانه ولی برای مانیتورینگ production نیاز به تفکیک has:redis دارد.
5. اسکرین‌شات پریویو در برخی حالت‌های تم شب آرتیفکت capture دارد — audit DOM/کنتراست جایگزین شده (مستند در commit فاز ۲).
6. **حسابداری خرید قبل از Phase 6 بی‌صدا fail می‌شد**: سند GRN/فاکتور با حساب `1300` پست می‌شد که در COA نیست و `.catch(() => undefined)` خطا را مخفی می‌کرد → یافته دود و اصلاح به GRNI (2150). **درس**: اسناد حسابداری هرگز نباید بی‌صدا swallow شوند — در سخت‌سازی آینده، شکست سند باید رویداد/لاگ خطا داشته باشد.
7. ~~`admin/inventory/bulk-price` PriceHistory را دور می‌زد~~ → **حل شد (Phase 6 closure)**: مسیر روی `PricingService.changePrice` یکسان شد؛ بدون levelId سطح صریح BASE نوشته می‌شود (با آینه variant.price) و هر تغییر PriceHistory + رویداد دارد. برای سطح‌های کانالی بدون ردیف VariantPrice، اولین تعدیل ردیف می‌سازد (fallback قیمت پایه = رفتار قدیمی، حفظ شده).
