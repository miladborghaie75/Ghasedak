# معماری افزونه POS + انبار + حسابداری — لباس زیر قاصدک

> مکمل `docs/backend-architecture.md` — طبق بند ۱۴۲: پیش از پیاده‌سازی، تایید شود.
> هیچ قاعده مالی/حسابداری‌ای از خود ساخته نشده؛ موارد باز در بخش «تصمیم‌های گم‌شده» است.

---

## ۰) بازبینی معماری فعلی و تداخل‌ها (بند ۱۴۲.۱–۶)

وضعیت موجود: مونوریپو pnpm/Turborepo؛ `apps/api` (NestJS skeleton + requestId + ErrorFilter بند ۶۵ + Health بند ۸۸)، `packages/database` (Prisma schema کامل)، `packages/contracts` (Money صحیح + ApiError + Pagination)، `apps/storefront` مهاجرت‌یافته و سالم.

**تداخل‌های واقعی با شِمای فعلی (قابل حل، بدون بازنویسی):**

| # | تداخل | راه‌حل |
|---|---|---|
| 1 | `ProductVariant.stockQty/reservedQty` اسکالر است — بند ۱۳۵ Ledger مرکزی می‌خواهد | qtyها به‌عنوان **Cache نمایشی** باقی می‌مانند و فقط توسط سرویس Ledger نوشته می‌شوند؛ حقیقت = جمع Ledger + رزرو. راه‌اندازی: Backfill از اسکالر |
| 2 | `InventoryMovement` فقط `delta/reason/refId` دارد — بند ۳۰/۳۱ نیاز به warehouse، movement دوطرفه، valuation دارد | مدل به **StockLedgerEntry** ارتقا می‌یابد (variantId→variantSku + warehouseId + type + qtyIn/qtyOut + unitCost + refType/refId + idempotencyKey). Migration اول data-migrate می‌کند |
| 3 | `ProductVariant.price/salePrice` تک‌قیمتی است — بند ۳ تا ۷ پنج سطح + سطوح کانالی می‌خواهد | `price/salePrice` = **Level 1 (POS)** می‌شود؛ جدول `variant_channel_prices` برای سطوح ۲ تا ۵. Effective price فقط سرور-side |
| 4 | `Order` فقط کانال سایت را مدل کرده؛ `MovementReason.ORDER` refId ندارد | `order.channelId` اضافه می‌شود (default: website)؛ Movementها به سفارش/فاکتور لینک می‌شوند |
| 5 | `MovementReason.MANUAL` — بند ۳۰ انواع دقیق‌تر می‌خواهد | enum به ۱۰ نوع بند ۳۰ گسترش می‌یابد (TRANSFER_IN/OUT جدا تا هر انتقال دو ردیف سند داشته باشد) |
| 6 | `Order.code` یکتاست ولی Numbering Series مستقل ندارد — بند ۸۱/۸۲ | `number_series` عمومی با scopeهای مستقل: POS invoice / Online order / Purchase / Payment / Journal / Return |
| 7 | `Payment` فقط به `Order` لینک است — بند ۱۸/۶۲ پرداخت چندروشی + چک | `payments.orderType` اضافه می‌شود (order\|pos_invoice\|purchase\|expense)؛ جدول `checks` مستقل |

عدم‌تداخل‌ها: `variant_terms` (سازگاری ترکیبی)، `orders` snapshot، `audit_logs`، `events`، `notifications` — همه عیناً استفاده می‌شوند.

---

## ۱) اصل یکپارچگی (بند ۱) و کانال‌ها (بند ۲)

هر فروش (سایت/POS/ترب/اسنپ‌پی) از یک مسیر واحد عبور می‌کند:

```
Sale (Order | PosInvoice)  →  StockLedgerEntry (OUT)  →  JournalEntry (بند ۴۸)
```

مدل `SalesChannel`:

```ts
id, name, slug, type(pos|online|marketplace|other), active,
priceLevel(1..5),                      // کدام سطح قیمت این کانال می‌بیند
paymentMethodIds[],                    // روش‌های مجاز
warehouseId,                           // انبار پیش‌فرض کانال
commissionRules JSONB,                 // درصدهای ترب/اسنپ‌پی
accountingMapping JSONB                // درآمد/تنخواه/تسویه کدام حساب‌ها
```

Seed اولیه: `pos`, `website`, `torob`, `snapp-pay`, `other` — ادمین می‌تواند کانال جدید بسازد.

---

## ۲) قیمت‌گذاری (بند ۳ تا ۷)

- `ProductVariant.price` = سطح ۱ (حضوری) — سازگار با دیتای فعلی.
- `VariantChannelPrice(variantId, channelId, price, salePrice?, saleStartsAt?, saleEndsAt?)` UNIQUE(variantId, channelId).
- **Effective price** سرور-side با اولویت بند ۷ محاسبه می‌شود: Variant price → Channel price → Scheduled sale → Coupon → Manual discount → Final.
- Coupon فقط روی Net-Sales (بعد از کانال/فروش) اعمال می‌شود؛ Manual discount در POS روی خط/فاکتور — **هر دو هرگز روی یک فاکتور جمع نمی‌شوند مگر Admin اجازه صریح** (جلوگیری از Double Discount بند ۷).
- API عمومی فقط قیمتِ کانالِ مجاز را برمی‌گرداند (بند ۴): guard کانال سمت سرور؛ Frontend هرگز ۵ قیمت را نمی‌بیند.

**تشخیص کانال (بند ۵):** کانال‌های خارجی با **signed token** (`?c=<channel>&s=<hmac>`، HMAC با کلید سرور، TTL) یا Partner API؛ Referer صرفاً لاگ می‌شود، هرگز مجوزدهی نمی‌شود. attribution سمت سرور.

---

## ۳) انبار (بند ۳۰ تا ۴۰، ۱۰۲ تا ۱۰۵)

`StockLedgerEntry` (append-only، هرگز update/delete):

```
id, warehouseId, variantSku, type(10 نوع بند ۳۰),
qtyIn, qtyOut, unitCost?,            // unitCost برای valuation ورودی
refType(order|pos_invoice|purchase|transfer|adjustment|stocktake|opening|damage|…), refId?,
idempotencyKey UNIQUE, actorId?, note?, createdAt
```

- `InventoryMovement` فعلی → migration به این مدل.
- **قابلیت اطمینان:** `available = sum(in) - sum(out) - activeReservations` — cache `stockQty` فقط برای سرعت نمایش.
- **Stock Reservation (بند ۱۰۲):** `StockReservation(variantSku, warehouseId, qty, state[active|released|consumed], refType, refId, expiresAt)` — سفارش آنلاین در لحظه ثبت رزرو می‌کند؛ پرداخت ناموفق/لغو → آزادسازی خودکار.
- **ثبات Online+POS (بند ۱۰۳):** همه تغییرات داخل `SELECT … FOR UPDATE` روی ردیف واریانت در یک تراکنش DB + idempotencyKey؛ بدون قفل، هیچ فروشی ثبت نمی‌شود.
- **Valuation (بند ۳۲/۳۳):** WAC به‌صورت پیش‌فرض (میانگین موزون پس از هر ورودی، در `variant_costs`)؛ معماری به‌گونه‌ای که FIFO بعداً به‌عنوان استراتژی دوم اضافه شود. `InventoryValuation(variantSku, warehouseId, qty, avgCost, totalValue)` — گزارش ارزش موجودی از همین جدول.
- **انبارگردانی/Reorder/Dead stock (بند ۳۶ تا ۴۰):** `Stocktake` + `StocktakeItem`؛ `ReorderPolicy(variantSku, minStock, reorderPoint, targetStock)`؛ گزارش Dead-stock از Ledger + فروش‌ها با پارامتر X ماه.
- **Transfer (بند ۳۵):** سند `StockTransfer` با دو ردیف Ledger (OUT از مبدا، IN به مقصد) در یک تراکنش.

---

## ۴) خرید و تامین‌کننده (بند ۲۷ تا ۲۹، ۴۳)

`Supplier(id, name, phone?, address?, taxId?, bankInfo JSONB, creditLimit?, notes)` · `SupplierHistory` از Ledger/سند استخراج می‌شود.

```
PurchaseOrder(id, supplierId, status[draft|sent|received|closed], items[])
GoodsReceipt(id, poId?, supplierId, warehouseId, items{variantSku, qty, unitCost}, landedCosts[])
PurchaseInvoice(id, supplierId, grId?, items, discount, shipping, tax, total, paymentStatus, payments[])
PurchaseReturn(id, supplierId, refType, items, reason)
```

- **Landed cost (بند ۴۳):** هزینه‌های acquisition (حمل/گمرک/بسته‌بندی) با قاعده تخصیص (weight/value/qty) به unitCost واریانت‌ها اضافه و در WAC لحاظ می‌شود.
- خرید ورودی → Ledger IN + سند حسابداری: `Debit: Inventory / Credit: AP`.

---

## ۵) POS (بند ۸ تا ۲۳، ۱۱۱ تا ۱۱۵)

`PosInvoice(id, code(series مستقل بند ۸۱), channelId, warehouseId, cashierId, customerId?,
            priceLevel(1..5، default 1), state[draft|held|finalized|cancelled],
            items{variantSku, qty, unitPriceSnapshot, discount}, extraCharges[], payments[],
            totals JSONB, notes, finalizedAt, idempotencyKey UNIQUE)` — snapshot کامل بند ۱۱۴/۱۱۵.

- **ترمینال:** صفحه `apps/admin/pos` (دسکتاپ/تاچ بند ۱۱۰)؛ جریان Barcode → Product → Qty → Payment → Invoice.
- **اسکنر USB/HID (بند ۹):** input focus + Enter detection + rapid scan + duplicate → qty+1.
- **Barcode (بند ۱۰/۱۱):** `VariantBarcode(variantSku, barcode UNIQUE, kind[manufacturer|internal|alternate])` — barcode جایگزین `ProductVariant.barcode` نمی‌شود؛ چند-بارکد پشتیبانی می‌شود. Generator با Prefix + EAN-13/Code128 + چاپ Label (بند ۱۲/۱۳، قالب قابل مدیریت).
- **سطح قیمت دستی (بند ۱۵):** فقط با Permission؛ سقف تخفیف (بند ۱۶) از `RolePermission` می‌آید؛ بیش از سقف → `ApprovalRequest`.
- **پرداخت چندروشی (بند ۱۸/۱۹):** `PosPayment(method[cash|card|transfer|online|credit|check|wallet], amount, ref?)` — جمع = Total.
- **صندوق/شیفت (بند ۲۰ تا ۲۲):** `CashRegister(name, location, openingBalance, assignedUsers)` + `CashierShift(registerId, userId, openingCash, expectedCash?, actualCash?, diff, state[open|closed])` — فروش نقدی شیفت → Expected؛ اختلاف → over/short ثبت و به GL می‌رود.
- **Receipt (بند ۲۳):** Print/PDF/Reprint با قالب قابل مدیریت؛ **Hold/Recall (بند ۱۱۲/۱۱۳):** state=held + لیست recall.
- **Offline (بند ۲۴):** V1 آنلاین؛ قابلیت offline-first فقط با قواعد رزرو سخت‌گیرانه بعداً.

---

## ۶) حسابداری (بند ۴۴ تا ۵۸، ۹۶، ۹۷، ۱۰۶، ۱۲۸)

**موتور Double-entry:**

```
FiscalYear(id, title, startsAt, endsAt, state[open|locked|closed])
Account(id, code UNIQUE, name, type[asset|liability|equity|revenue|cogs|expense],
        parentAccountId?, level, isActive)
JournalEntry(id, number(series), date, description, sourceType, sourceId, state[draft|final], isReversalOf?)
JournalLine(id, entryId, accountId, debit, credit, costCenterId?, partyType?, partyId?)
```

- **قید سخت:** `Σ debit == Σ credit` در سطح entry — سرویس ثبت entry قبل از persist اعتبارسنجی می‌کند؛ تست خودکار بند ۱۲۸.
- **اتوماسیون (بند ۴۸/۴۹):** هر فروش/برگشت/خرید/هزینه/چک → سند خودکار از `accountingMapping` کانال/روش پرداخت. مثال فروش: `Dr Cash/Bank/AR — Cr Sales Revenue` + `Dr COGS — Cr Inventory`.
- **Report source of truth (بند ۱۰۶/۱۰۷):** P&L، Balance Sheet، Trial Balance، GL، Cash Flow — همه از Ledger؛ گزارش‌های مدیریتی از Sales/Inventory + Ledger.
- **Immutability (بند ۹۷):** سند final → edit ممنوع؛ فقط Reversal/Adjustment با سند جدید.
- **Chart of Accounts (بند ۴۵/۴۶):** قابل مدیریت از پنل؛ seed اولیه ۶ نوع حساب با سطوح گروه/کل/معین/تفصیلی.
- **Opening (بند ۵۱/۱۲۰):** `OpeningBalanceEntry` با سند مخصوص؛ **Year-end (بند ۵۲):** Closing سند انتقال Revenue/Expense به Equity.

---

## ۷) نقد، بانک، چک، هزینه (بند ۵۹ تا ۷۲)

```
CashAccount(id, name, kind[cash|bank|card_settlement|online_gateway], glAccountId, openingBalance, currentBalance)
BankAccount(id, name, bankName, accountNumber, iban?, glAccountId, openingBalance, currentBalance)
BankStatement(id, bankAccountId, date, amount, description, matchedPaymentId?)
Check(id, direction[received|issued], number, bankName, branch?, accountNo?, amount,
      issueDate, dueDate, drawer, payee, status[…بند ۶۵], sourceType?, sourceId?, notes?)
Expense(id, date, categoryId, amount, cashAccountId, description, attachmentId?, vendor?, costCenterId?, isRecurring?)
ExpenseCategory(id, name, glAccountId)
```

- **Check Calendar/Reminder (بند ۶۶/۶۷/۹۱/۹۲):** `Reminder(title, dueAt, repeat, relatedEntity, priority, status, channels)` + تقویم شمسی؛ یادآور ۷/۳/۱ روز قبل با BullMQ.
- **Petty cash (بند ۷۲):** CashAccount با kind=cash و فلگ petty — Opening/Expense/Replenishment/Closing.
- **Receivable/Payable (بند ۷۳/۷۴/۷۵):** از AR/AP در GL + aging گزارش؛ فروش نسیه با `CreditPolicy(customerId, creditLimit, outstanding)`.

---

## ۸) مالیات (بند ۷۸ تا ۸۰)

`TaxRate(id, name, percent, appliesTo, active)` — محاسبه همیشه سرور-side؛ **هیچ ادعای انطباق مودیان نمی‌شود** (بند ۸۰)؛ ماژول `tax/moadian` به‌صورت placeholder با interface آماده، بدون پیاده‌سازی API بدون مستندات رسمی.

---

## ۹) شماره‌گذاری و Snapshot (بند ۸۱/۸۲/۱۱۴/۱۱۵)

`NumberSeries(scope, prefix, nextNumber, padding)` — scopeهای مستقل: `pos_invoice`, `online_order`, `purchase_invoice`, `payment`, `receipt`, `journal`, `stock_transfer`, `return`. تخصیص داخل تراکنش DB (SELECT FOR UPDATE) — بدون گپ/تکرار.

همه اسناد مالی **snapshot** دارند (بند ۱۱۴/۱۱۵): نام/SKU/واریانت/قیمت/تخفیف/مالیات/هزینه — تغییر آتی محصول اثر ندارد.

---

## ۱۰) گزارش‌ها و داشبورد (بند ۸۳ تا ۹۰، ۱۰۶، ۱۰۷)

- **Financial (از Ledger):** Trial Balance، GL، P&L، Balance Sheet، Cash Flow، AR/AP Aging.
- **Management (از Sales/Inventory):** Sales per channel/cashier/price-level، Product performance، ABC، Dead/Fast/Slow stock، Profit per product (Revenue − COGS − تخصیص) — COGS فقط از Valuation Engine (بند ۱۰۵).
- **Dashboards:** داشبورد ادمین + داشبورد POS (فروش امروز، Low stock، Checks نزدیک).
- Export CSV/Excel/PDF (بند ۱۰۸) و Print templates (بند ۱۰۹).

---

## ۱۱) نقش‌ها و مجوزها (بند ۹۸ تا ۱۰۱، ۱۱۵)

نقش‌های جدید به `UserRole` اضافه می‌شود: `ACCOUNTANT`, `CASHIER`, `INVENTORY_MANAGER`, `SALES_MANAGER` (+ موجودها). Permissionهای granular جدید: `pos.sell`, `pos.discount.<pct>`, `pos.returns.<limit>`, `inventory.adjust`, `accounting.entries.read/write`, `checks.manage`, `expenses.manage`, `reports.financial.read`, `settings.update` — Guard از RolePermission می‌خواند (بند ۱۰۰: Accountant به محصولات/کاربران دسترسی ندارد).

`ApprovalRequest(id, type[large_discount|cancel_invoice|refund|stock_adjust|price_change|expense_delete], payload, requestedBy, state[pending|approved|rejected], decidedBy, decidedAt)` — بند ۱۰۱.

---

## ۱۲) Events، Audit، Idempotency (بند ۵۵، ۹۶، ۱۲۷)

- Eventهای جدید به `events`: `pos_invoice_finalized`, `stock_movement_created`, `journal_entry_posted`, `check_status_changed`, `shift_closed`, `expense_created`.
- Audit شامل: تغییر قیمت/موجودی/تخفیف/چک/سند/مجوز — old/new value (بند ۹۶).
- **Idempotency (بند ۱۲۷):** همه finalizationها با `idempotencyKey UNIQUE` — دوبار ثبت ممنوع؛ Payment callback هم از همین قید استفاده می‌کند.

---

## ۱۳) تست (بند ۱۲۸ تا ۱۳۲)

- **Accounting:** هر entry → assert ΣDr=ΣCr؛ P&L/Balance/TB سازگاری متقابل.
- **POS E2E:** scan→cart→discount→multi-payment→finalize→ledger OUT→journal→receipt.
- **Inventory:** purchase/sale/return/transfer/adjust/stocktake/reservation/cancel.
- **Price levels:** POS→L1، Website→L2، Torob→L3، SnappPay→L4 — API عمومی هرگز سطوح غیرمجاز را برنمی‌گرداند.
- **Concurrency:** دو فروش هم‌زمان آخرین موجودی — فقط یکی موفق.

---

## ۱۴) فازهای پیاده‌سازی (بند ۱۴۱)

```
Phase 1  Accounting domain (COA + Journal + FiscalYear + Opening)
Phase 2  Barcode + Variant extension
Phase 3  Inventory Ledger + Valuation (WAC)
Phase 4  Pricing / 5 levels + Channel security
Phase 5  POS (terminal + shift + receipt)
Phase 6  Sales/Returns (online + POS)
Phase 7  Purchasing/Suppliers
Phase 8  Cash/Bank
Phase 9  Checks
Phase 10 Expenses
Phase 11 Financial reports
Phase 12 Management reports
Phase 13 Tax/Moadian readiness
Phase 14 Audit/Security hardening
Phase 15 Testing
Phase 16 Production deployment
```

**واحد کار:** هر فاز = migration + service + API + UI ادمین + تست؛ بدون بازنویسی ماژول‌های سالم (بند ۱۱۲ سند قبلی).

---

## ۱۵) ریسک‌ها

1. **Prisma + `SELECT FOR UPDATE`:** با `$queryRaw` داخل `$transaction` انجام می‌شود — الگوی ثابت برای همه عملیات حساس.
2. **Migration داده فعلی:** `InventoryMovement` فعلی data-migrate می‌شود؛ قبل از migration باید بک‌آپ DB گرفته شود.
3. **POS UI:** بخش سنگین فرانت است؛ پیشنهاد: `apps/admin/pos` با state ساده (نه Redux/Zustand) و keyboard-first.
4. **Persian Calendar (بند ۱۱۷):** `date-fns-jalali` برای نمایش/گزارش؛ DB همیشه UTC timestamp.
5. **حجم گزارش‌های سنگین:** background job + pagination (بند ۱۲۵).
6. **Money:** همه محاسبات از `@ghasedak/contracts/money` — بدون float (بند ۹۷ سند قبلی).

---

## ۱۶) تصمیم‌های گم‌شده (بند ۱۴۲.۱۵) → همه تایید شدند

| # | تصمیم | انتخاب نهایی |
|---|---|---|
| 1 | انبار | **یک Main Warehouse در V1** (POS/سایت/سایر کانال‌ها از همان موجودی مرکزی)؛ اما مدل از روز اول **Multi-Warehouse**: مدل Warehouse(id,name,code,type,address,active,priority)، Ledger با warehouseId، Transfer/Request/Stocktake/گزارش به تفکیک انبار، Warehouse پیش‌فرض هر کانال — بدون تغییر مدل Product/Variant/Order/Ledger در آینده. Channel و Warehouse دو مفهوم مستقل‌اند |
| 2 | ارزش‌گذاری | **WAC در V1 با معماری Strategy-based** (WACCostingStrategy فعال؛ FIFOCostingStrategy آینده) — Cost Layer شامل quantity/total_cost/average_unit_cost/last_cost/costing_version؛ انتقال بین انبارها Cost Basis را حفظ می‌کند؛ برگشت فروش COGS را اتمیک اصلاح می‌کند؛ همه عملیات Costing transactional/auditable/idempotent و بازسازی‌پذیر از Ledger؛ فقط Integer/تومان |
| 3 | نسیه/اعتبار | **V1 غیرفعال، معماری Credit/AR-ready**: مدل‌های CustomerAccount/AccountsReceivable/CreditPolicy/CreditTransaction/AgingBucket از ابتدا در شِما؛ در V1 گزینه Credit در POS/Checkout دیده نمی‌شود و Aging عملیاتی نمی‌شود؛ هیچ بدهی ساختگی ایجاد نمی‌شود |
| 4 | مالیات | **ساختار کامل، نرخ پیش‌فرض ۰٪**: TaxRate/TaxRule/TaxCategory/TaxTransaction + snapshot tax روی سند؛ محاسبه فقط Backend با Money abstraction؛ Frontend هرگز مالیات را محاسبه نمی‌کند؛ هیچ ادعای انطباق مودیان بدون بررسی مستندات رسمی |

### جزئیات تاییدشده انبار (گزینه ۱)

- Main Warehouse با code = `MAIN` seed می‌شود؛ همه کانال‌های V1 از آن می‌فروشند.
- `warehouseId` روی Ledger/Reservation/Stocktake/Valuation/Channel اجباری است.
- Stock Transfer = دو ردیف Ledger (OUT/IN) در یک تراکنش اتمیک + Audit.
- موجودی هرگز global نگه‌داری نمی‌شود: یا از Ledger محاسبه، یا از projection معتبر خوانده می‌شود.
- در آینده انبارهای فروشگاه/آنلاین/شعبه/مرجوعی/قرنطینه بدون تغییر مدل Product/Variant/Order/Ledger اضافه می‌شوند.

### جزئیات تاییدشده WAC (گزینه ۲)

- `CostLayer(variantSku, warehouseId, quantity, totalCost, avgUnitCost, lastCost, costingVersion)` — projection valuation.
- COGS فقط از Costing Engine؛ Admin هرگز COGS را دستی وارد نمی‌کند (بند ۱۰۵).
- خرید/رسید/برگشت خرید/فروش/برگشت فروش/تعدیل/انتقال همگی در Costing لحاظ می‌شوند.
- Landed Cost تخصیص‌یافته به بهای تمام‌شده ورودی اضافه می‌شود.
- تاریخچه immutable است؛ قیمت خرید جدید COGS گذشته را عوض نمی‌کند.

### جزئیات تاییدشده Credit/AR (گزینه ۳)

- شِما شامل CustomerAccount/AccountsReceivable/CreditPolicy/CreditTransaction/AgingBucket است ولی سرویس Credit Sale در V1 guard=off دارد.
- SalesChannel.paymentMethodIds در V1 چک/کارت/نقد/آنلاین دارد و Credit شامل نمی‌شود.

### جزئیات تاییدشده مالیات (گزینه ۴)

- `TaxRate(name, code, rate, jurisdiction, effectiveFrom, effectiveTo, active, taxType)` seed: نرخ ۰٪ «بدون مالیات».
- `Order/PosInvoice` فیلدهای مستقل: subtotal/discountTotal/shippingTotal/taxableAmount/taxTotal/grandTotal.
- Tax Snapshot روی سند؛ تغییر نرخ آینده اسناد تاریخی را تغییر نمی‌دهد.
