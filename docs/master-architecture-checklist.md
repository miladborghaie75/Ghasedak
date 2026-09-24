# Master Architecture Checklist — قاصدک (نسخه نهایی معماری)

> این سند، فهرست ۳۰ حوزه شما را به «جای مشخص در سیستم» تبدیل می‌کند: مدل DB، رویدادها، API، مجوز، فاز.
> قاعده کلیدی شما اعمال شده: **از این پس قابلیت فروشگاهی جدید اضافه نمی‌شود** مگر نیاز واقعی جاافتاده باشد.
> «قابلیت‌سازها» (Feature Flag/Consent/Outbox/StockAlert) همین امروز به شِما اضافه و migrate شدند — چون همه ماژول‌های بعدی به آن‌ها وابسته‌اند.

## ۱) قرارداد Event Bus (متعلق به همه ماژول‌ها)

- ثبت رویداد در `DomainEventOutbox` **داخل همان تراکنش دامنه**؛ worker جدا توزیع می‌کند (at-least-once + مصرف‌کننده‌ها idempotent با unique `[name, payload]`).
- Taxonomy فعلی: `OrderCreated, PaymentVerified, PaymentFailed, InventoryReserved, InventoryConsumed, InventoryReleased, SalePosted(COGS), ReturnApproved, RefundCompleted, StockAdjusted, ProductCreated, PriceChanged, StockAlertTriggered, CustomerConsentChanged` — هر ماژول جدید فقط این لیست را گسترش می‌دهد، bus دوم ساخته نمی‌شود.

## ۲) ماتریس اصلی — 🔴 ضروری برای معماری

| # | حوزه | جای سیستم | رویدادهای کلیدی | مجوز | فاز |
|---|---|---|---|---|---|
| 1 | Shipping/LMS | `Shipment` + `ShippingZone/Method` (موجود) + آینده: `Carrier`, `ShipmentParcel`, `CarrierSettlement`, هزینه واقعی/تخمینی | ShipmentCreated, Shipped, Delivered | `shipping.manage` | S |
| 2 | RMA | `ReturnRequest/Item(condition)/Policy/Refund` (موجود، بهداشتی-aware) | ReturnApproved, RefundCompleted | `returns.manage` | R |
| 3 | Promotion Engine | `Coupon` + آینده `Promotion` (rule-based، بدون تداخل بدون تایید — بند ۱۴ سند قبلی) | DiscountApplied | `marketing.manage` | T |
| 4 | Event Bus | `DomainEventOutbox` ✅ امروز | — | `system.health` (پایش) | AB |
| 5 | Integration Hub | `WebhookEvent` + `SalesChannel.integration` + آینده `IntegrationConnection/Job/Log` | webhook.* | `integrations.manage` | Z |
| 6 | Task Queue | Redis/BullMQ (docker-compose موجود) + Outbox worker | job.* | `system.health` | AB |
| 7 | Webhook System | `WebhookEvent` ورودی (موجود) + خروجی آینده | — | `integrations.manage` | AB |
| 8 | Security/2FA | AdminSession + آینده `TotpSecret`, LoginAttempt, rate-limit | SessionRevoked | `roles.manage` | AC |
| 9 | Backup/DR | pg_dump روزانه + سند RPO/RTO در `docs/deployment.md` (آینده) | BackupCompleted | `backup.manage` | AD |
| 10 | Monitoring | Health (موجود) + Business dashboard فاز V | — | `reports.view` | AC/V |
| 11 | Media Management | `Media` + `Attachment` (موجود) + آینده: usage-index, duplicates, CDN | MediaProcessed | `media.manage` | X |
| 12 | Feature Flags | `FeatureFlag` ✅ امروز — seed خاموش: ai/instagram/loyalty/marketplace | flag toggled → audit | `settings.manage` | همین امروز |
| 13 | Privacy/Consent | `ConsentRecord` ✅ امروز + retention در settings | CustomerConsentChanged | `customers.manage` | همین امروز |
| 14 | Search | نرمال‌سازی فارسی + pg_trgm؛ مهاجرت آینده Meilisearch (بدون تغییر contract) | — | — | W |
| 15 | Approval System | `ApprovalRequest` (موجود) + قواعد سقف از `RolePermission` | ApprovalDecided | `orders.update` و… | پراکنده |

## ۳) ماتریس تکمیلی — 🟠 بسیار کاربردی

| # | حوزه | جای سیستم | فاز |
|---|---|---|---|
| 16 | Loyalty | `CustomerAccount` (موجود) + آینده `LoyaltyLedger/PointRule/Tier` — **هرگز عدد مستقیم روی مشتری**؛ ledger مثل انبار | U+ |
| 17 | Wishlist+Restock | `WishlistItem` + `StockAlert` ✅ امروز؛ رویداد `StockAlertTriggered` فقط وقتی available>0 | U |
| 18 | Review حرفه‌ای | `Review` + آینده: ابعاد سایز/راحتی/کیفیت + عکس + moderation queue | U |
| 19 | Size Recommendation | `SizeGuide` + قواعد به‌ازای محصول/برند (`NeedFinder` infra مشترک) | U |
| 20 | Product Recommendation | رویدادمحور: also-bought از OrderItem؛ بدون وابستگی به AI | V+ |
| 21 | CRM | `Customer` + timeline از Orders/Payments/Returns/Tickets | U |
| 22 | Procurement | `Supplier/PO/GoodsReceipt/QualityCheck(آینده)` + قیمت‌های خرید تاریخی از PurchaseInvoiceItem | N |
| 23 | Forecasting | گزارش از Ledger+Orders (سرعت فروش/Lead time)؛ AI فقط لایه اختیاری | V+ |
| 24 | Multi-branch | `Branch` ✅ موجود + branchId اختیاری روی Warehouse/Register/User | آماده |
| 25 | Affiliate | آینده `Affiliate(referralCode)/CommissionLedger` — تسویه از AP؛ لغو با ReturnApproved | + |
| 26 | BI Dashboard | تجمیع گزارش‌های V روی Accounting/Ledger | V |

## ۴) 🟢 بعداً (بدون رزرو DB الان)

27. A/B Testing (فقط پس از Consent) · 28. AI Agents پیشرفته (`ai.view/use/configure` آماده) · 29. Predictive Analytics · 30. اتوماسیون بازاریابی · 31. کانال‌های فروش جدید (فقط ردیف SalesChannel)

## ۵) قواعد پایدار (تا اطلاع ثانوی)

1. ماژول جدید = ۵ ستون همین جدول پر می‌شود (DB/Event/API/Permission/Phase) — سند جدید ممنوع.
2. هیچ ماژولی مستقیم ماژول دیگر را صدا نمی‌زند؛ فقط **Outbox event**.
3. هیچ سرویسی وضعیت مالی/موجودی را مستقل محاسبه نمی‌کند (بند ۱۰۷ سند Master).
4. Feature پیش‌فرض خاموش؛ فعال‌سازی از Admin با audit.
5. هر ریسک/تقلب → `REQUIRES_REVIEW` انسانی؛ هیچ تصمیم قطعی خودکار (بند ۲۱ شما).
