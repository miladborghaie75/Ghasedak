# تحلیل معماری پلتفرم — لباس زیر قاصدک (خروجی اول بند ۹۶)

> این سند، نسخه تلفیقی و نهاییِ سه سند قبلی است و بر هر سه **تقدم دارد**:
> `backend-architecture.md` (بک‌اند پایه) · `commerce-suite-architecture.md` (POS/انبار/حسابداری) · `architecture-v2.md` (فرانت)
> طبق بند ۹۶: پیش از پیاده‌سازیِ بزرگ، خروجی اول است. هیچ قاعده کسب‌وکاری بدون ذکر منبع اختراع نشده.

---

## ۱) تحلیل معماری فعلی (بند ۹۶.۱ + بند ۱)

### ۱.۱ موجود (بدون تکرار تاریخچه — جمع‌بندی تاییدشده)

| لایه | وضعیت |
|---|---|
| مونوریپو pnpm + Turborepo | ✅ `apps/storefront` (Next.js 15، سالم و build می‌شود)، `apps/api` (NestJS skeleton + requestId + ErrorFilter بند ۶۵ + Health بند ۸۸)، `packages/contracts` (Money صحیح IRT BigInt + ApiError + Pagination)، `packages/database` (Prisma)، `packages/utils` |
| شِما Prisma | ~۹۶۰ خط پایه + ~۹۵۰ خط Commerce Suite (اخرین generate موفق): محصول/واریانت/اتریبیوت پویا، سفارش/پرداخت/کوپن، CMS/SEO، Warehouse/Ledger/Reservation/CostLayer(WAC)/Transfer/Stocktake، SalesChannel/VariantChannelPrice/VariantBarcode، FiscalYear/Account/Journal/NumberSeries، Purchase/GoodsReceipt/Invoice(+LandedCost)، PosInvoice/PosPayment/CashRegister/CashierShift، Cash/Bank/Check/Expense، CustomerAccount/AR/Credit، SupplierAccount/AP، TaxRate/Rule/Transaction، Approval/Reminder |
| Auth/RBAC | مدل داده موجود (User.role enum + RolePermission + AdminSession)؛ **سرویس NestJS هنوز پیاده نشده** |
| DB زنده | ❌ Docker/Postgres روی این سیستم موجود نیست → migration و seed مسدود |

### ۱.۲ شکاف‌های سند جدید نسبت به شِمای موجود (بند ۱.۹)

| # | الزام سند جدید | وضعیت شِما | اقدام |
|---|---|---|---|
| 1 | بند ۱۰: **سطوح قیمت configurable**، نه دقیقاً ۵ | `VariantChannelPrice.priceLevel Int` — «مفهوم سطح» entity ندارد؛ نام/کد/بازه اعتبار هر سطح قابل مدیریت نیست | مدل **`PriceLevel`** + بازطراحی `VariantPrice(variantSku, priceLevelId, price, salePrice…)` — جایگزین `VariantChannelPrice` قبل از اولین migration (هنوز DB وجود ندارد → رایگان) |
| 2 | بند ۱۳: **Price History** با old/new/reason | ندارد | `PriceHistory` + ثبت خودکار در سرویس قیمت |
| 3 | بند ۱۹: Ledger با **before/after quantity** | `StockLedgerEntry` فقط qtyIn/qtyOut دارد | افزودن `balanceBefore`/`balanceAfter` — برای بازسازی/تطبیق/رصد پرش‌های غیرعادی |
| 4 | بند ۲۹: **Refund** تراکنش مالی واقعی | `Payment` فقط درگاه آنلاین؛ Refund ندارد | `Refund`/`RefundItem` (روش‌های نقد/بانک/اعتبار فروشگاه) |
| 5 | بند ۲۸: برگشت با **condition** (sellable/damaged/quarantine) | `ReturnRequest.items Json` ساده | بازطراحی `ReturnRequest` + `ReturnItem(condition)` — وجه مقصد انبار مرجوعی/قرنطینه |
| 6 | بند ۳۰: **Shipment** جدا از Order + بند ۶۴/۶۶ webhook عمومی | `trackingCode` روی Order | `Shipment` + `WebhookEvent` عمومی |
| 7 | بند ۴۴: صف **TaxSubmission (مودیان)** | `TaxTransaction` محاسبه دارد، submission ندارد | `TaxSubmission` (status/error/retry) |
| 8 | بند ۵۸: **Attachment** برای اسناد | `attachmentId` متن پراکنده | `Attachment` (media-backed) + جایگزینی فیلدهای پراکنده |
| 9 | بند ۵۰: **Branch** | ندارد | `Branch` (نرم — در V1 یک branch) + optional بر Warehouse/Register/User |
| 10 | بند ۶۹: **Bundle** | ندارد | `ProductBundle` + مصرف اجزا در Ledger (فاز آینده؛ مدل از الان) |
| 11 | بند ۱۶: وضعیت‌های partial_returned/refunded + ترنزیشن معتبر | enum دارد ولی ترنزیشن در سرویس تعریف نشده | جدول ترنزیشن مجاز در Order domain (کد، نه DB) |
| 12 | بند ۸۳: **Return Policy Engine** قابل تنظیم | ندارد | `ReturnPolicy` (پنجره/شرط/تایید) — policyها داده‌اند نه کد |

### ۱.۳ چیزی که **نباید** تغییر کند (بند ۹۷)

- `variant_terms` + سازگاری ترکیبی فرانت — قرارداد فعلی storefront
- Snapshotها روی Order/PosInvoice/OrderItem
- `idempotencyKey`ها و append-only بودن Ledger
- Money abstraction (`packages/contracts/money.ts`)
- اصول فرانت: پالت/RTL/بدون مدل زن/بدون داده جعلی

---

## ۲) تصمیم فناوری (بند ۲ — تکرار نمی‌شود، مرجع)

**NestJS + TypeScript + PostgreSQL 16 + Prisma 6 + Redis/BullMQ + S3-compatible** — استدلال کامل در `backend-architecture.md §۱`. تغییر از Drizzle به Prisma ثبت شده. رد شده: Medusa/Saleor، میکروسرویس، MongoDB، WordPress/Woo.

---

## ۳) مدل قیمتی جدید (بند ۱۰/۱۱/۱۲/۱۳ — اصلاح مهم)

```
PriceLevel(id, code UNIQUE, name, sortOrder, active,
           currency IRT, taxBehavior, startsAt?, endsAt?,
           restriction JSONB {channelIds?, customerTagIds?})

VariantPrice(id, variantSku, priceLevelId, price, salePrice?,
             saleStartsAt?, saleEndsAt?)  UNIQUE(variantSku, priceLevelId)

SalesChannel(..., priceLevelId → PriceLevel, inventoryPolicy, orderSource,
             mapping JSONB {externalSkuMap}, integration JSONB)

PriceHistory(id, variantSku, priceLevelId, oldPrice, newPrice, reason?,
             actorId, createdAt)   ← فقط رکورد، هیچ محاسبه‌ای از آن نمی‌خواند
```

- **تشخیص کانال (بند ۱۲):** فقط signed token (`?c=&s=HMAC`)، Partner API key، یا نشست احرازشده؛ attribution سرور-side؛ Referer هرگز مجوزدهی نمی‌شود.
- **Effective price (بند ۱۴/۱۵):** Zنجیره: VariantPrice(level) → scheduled sale → coupon → manual (POS) — فقط در `PricingService` سرور.

## ۴) Ledger با تراز (بند ۱۹/۱۸/۶۷)

```
StockLedgerEntry(..., balanceBefore Int, balanceAfter Int, unitCost?, idempotencyKey UNIQUE)
StockReservation(state: ACTIVE|RELEASED|CONSUMED, expiresAt)
available(warehouse, variant) = ΣIN − ΣOUT − ΣACTIVE reservations   ← فقط از Ledger
```
همه عملیات حساس: `$transaction` + `SELECT … FOR UPDATE` روی ردیف واریانت/سطح؛ `idempotencyKey` در همه finalizeها (بند ۶۷/۶۸).

## ۵) برگشت/بازپرداخت (بند ۲۸/۲۹)

```
ReturnRequest(id, orderOrInvoice, state REQUESTED→APPROVED→RECEIVED→SETTLED/REJECTED, policyId?)
ReturnItem(requestId, orderItemId, qty, condition: SELLABLE|DAMAGED|QUARANTINE|INSPECT, reason)
   → SELLABLE → انبار مقصد: main؛ DAMAGED/QUARANTINE → انبار quarantine
Refund(id, number, refundType FULL|PARTIAL, method CASH|BANK|STORE_CREDIT|ORIGINAL,
       amount, state, sourceType, sourceId, idempotencyKey)
RefundItem(refundId, orderItemId?, qty, amount)
```
برگشت = Ledger IN (به انبار مقصد بر اساس condition) + سند حسابداری معکوس + Refund مستقل.

## ۶) Shipment / Webhook / TaxSubmission / Attachment / Branch / Bundle

```
Shipment(id, orderId, methodId, provider, trackingCode?, status, labelPrintedAt?)
WebhookEvent(id, provider, eventType, externalId, signatureValid, status PENDING|OK|FAILED,
             retries, payload JSONB, processedAt?, error?)   ← بند ۶۴: verify+idempotent+retry
TaxSubmission(id, taxTransactionId, status, attempts, lastError?, submittedAt?, response JSONB)
Attachment(id, mediaId, ownerType, ownerId, title?)          ← بند ۵۸
Branch(id, name, code, active) + branchId اختیاری روی Warehouse/CashRegister/User
ProductBundle(id, productId, items{variantSku, qty})          ← مصرف اجزا در Ledger (فاز آینده)
```
`OrderStatus` با `PARTIALLY_RETURNED`/`REFUNDED` کامل می‌شود؛ ترنزیشن‌های مجاز در کد domain (مپ صریح، تست‌پذیر — بند ۱۶/۱۷).

## ۷) RBAC و ترنزیشن‌های خطرناک (بند ۴۸/۴۹/۸۴/۸۵)

- Permissionهای جدید: `pos.pricelevel.select`, `pos.discount.beyond:<pct>`, `refunds.create`, `returns.approve`, `stock.adjust.approve`, `prices.write`, `prices.approve`, `periods.lock`, `reports.financial.read`
- `PriceLevel.restriction` + سقف تخفیف از RolePermission؛ `ApprovalRequest` برای فراتر رفتن (موجود).
- fiscal period بسته → هر posting رد می‌شود (بند ۸۶)؛ اصلاح فقط با سند reversal در دوره باز.

## ۸) فازبندی به‌روزشده (بند ۹۴ — با توجه به مسدودی DB)

```
فاز 0 (اکنون، بدون DB): تکمیل شِما (بند ۱.۲) + ترنزیشن‌های Order + PricingService contract
فاز 1: Auth/RBAC service + Product/Variant API        ← نیازمند DB
فاز 2: Inventory/Warehouse/Barcode/Ledger             ← نیازمند DB
فاز 3: Pricing/Levels/Channels/Coupons
فاز 4: Orders/Cart/Checkout/Payment/Shipping
فاز 5: POS کامل (terminal/shift/receipt/returns)
فاز 6: Purchasing/Suppliers
فاز 7: Accounting Engine + COGS
فاز 8: CRM/AR/AP
فاز 9: Reports/Dashboard/ABC/Dead stock
فاز 10: Integrations (Torob/SnappPay/Providers/Tax submission queue)
فاز 11: Backup/Monitoring/Hardening/Deploy
```
هر فاز طبق بند ۹۵: بازبینی → scope → شِما → دامنه → API → authZ → تست → migration → verify → مستند.

## ۹) ریسک‌های کلیدی

1. **مسدودی DB** — تا راه‌اندازی Postgres، فازهای ۱+ قابل verify نیستند؛ فاز 0 شِما-محور است.
2. **تغییر مدل قیمت قبل از اولین migration** — آخرین فرصت رایگان؛ بعد از آن data-migration لازم می‌شود.
3. **حجم شِما** — ۱۹۰۰+ خط؛ کنترل از طریق فازبندی و migrationهای کوچک.
4. **POS UI** — فاز ۵ سنگین‌ترین بخش فرانت است؛ keyboard-first و بدون state library.
5. **مالیات/مودیان** — هیچ ادعای انطباق؛ فقط صف submission آماده تا بررسی مستندات رسمی (بند ۴۴).
