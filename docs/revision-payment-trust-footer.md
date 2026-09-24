# بازنگری معماری — پرداخت، اعتماد و فوتر (ادغام سند جدید در پلتفرم موجود)

> طبق بند ۵۵: خروجی پس از ادغام، پیش از کدنویسی.
> مرجع قبلی: `platform-architecture.md` (تقدم‌یافته) + `commerce-suite-architecture.md` + `backend-architecture.md`.
> قاعده: یک سیستم پرداخت، یک سفارش، یک انبار، یک حسابداری — بدون ماژول دوم (بند ۵۶).

---

## ۱) آنچه بدون تغییر می‌ماند (بند ۵۵.۱)

- مونوریپو، استک (NestJS/Prisma/Postgres/Redis)، Money abstraction، ErrorFormat بند ۶۵، requestId
- جدا بودن ORDER / PAYMENT / INVENTORY / ACCOUNTING به‌عنوان دامنه‌های مستقل با تراکنش مشترک
- اصل snapshot روی اسناد، append-only Ledger، idempotencyKey در همه finalizeها
- فروشگاه: RTL/Palette/بدون مدل زن/بدون داده جعلی (شامل: بج اعتماد جعلی ممنوع — بند ۴۶ با قاعده قبلی هم‌راستاست)

## ۲) آنچه گسترش می‌یابد (بند ۵۵.۲)

| مفهوم موجود | گسترش |
|---|---|
| `Payment` (فقط درگاه آنلاین، به Order) | → **PaymentAttempt** با state machine کامل بند ۸؛ چند attempt برای یک Order (بند ۹) |
| `PaymentGateway` (زرین‌پال V1) | → Provider abstraction با چند provider؛ credentials رمز؛ هرگز به فرانت |
| پرداخت POS (`PosPayment`) | بدون تغییر — کانال حضوری با methods نقد/کارت/چک/آنلاین |
| `Refund` | اتصال به PaymentAttempt (original_method) + API refund درگاه در صورت پشتیبانی |
| `WebhookEvent` عمومی | مصرف برای callbackهای درگاه: verify + idempotency + retry (قبلاً طراحی شده) |
| `BankAccount` | نگه‌داشته می‌شود؛ **`CardToCardAccount`** جدا می‌شود چون facing-customer است و فیلدهای نمایشی دارد |
| `Menu`/`MenuItems` فوتر | گسترش با **`TrustBadge`** و `placement=footer_trust|checkout` |
| فایل‌رسانه | `Attachment` برای رسید کارت‌به‌کارت (media-backed، non-public) |

## ۳) آنچه جایگزین می‌شود (بند ۵۵.۳)

- `Payment.status` تکی → `PaymentAttempt.state` با ۱۳ حالت بند ۸ و ترنزیشن‌های مجاز مپ‌شده در کد
- منطق «پرداخت موفق = تایید فرانت» هرگز — فقط Server-side verify

## ۴) تناقض‌های یافته‌شده (بند ۵۵.۴)

| # | تناقض | تصمیم |
|---|---|---|
| 1 | سند قبلی: `Payment(orderId, gatewayId, …)` تکی. سند جدید: چند attempt برای یک سفارش | مدل جدید PaymentAttempt؛ جدول Payment قدیمیِ سِمِ درگاه فقط attempt آنلاین را می‌سازد — حذف فیزیکی نه، migration مدل |
| 2 | سند قبلی checkout: «پرداخت X تومان» در PDP/checkout. سند جدید: همان CTA باید روی **صفحه پرداخت** هم باشد | سازگار — به فرانت اضافه می‌شود نه جایگزین |
| 3 | کارت‌به‌کارت در سند قبلی فقط method بود (PosPaymentMethod.CHECK/…) | اکنون روش واقعی با submission/verification مستقل — به دامنه پرداخت آنلاین اضافه می‌شود نه POS |
| 4 | `PaymentMethod` بند ۴ جدید با `PaymenMethod`های پراکنده قبلی (PosPaymentMethod enum، SalesChannel.paymentMethodIds string[]) | یکپارچه‌سازی: `PaymentMethod` entity قابل مدیریت؛ PosPayment/Order به آن FK می‌گیرند؛ enum سخت حذف تدریجی |
| 5 | بج اعتماد در فوتر قبلاً «قابل مدیریت» بود ولی entity نداشت | `TrustBadge` entity جدید + API عمومی |

## ۵) یکپارچگی پرداخت با دامنه‌ها (بند ۵۵.۵–۷)

```
Order → PaymentAttempt(created) → [gateway redirect] → callback(WebhookEvent)
      → verify(server-side) → state=paid → Order.paymentStatus=PAID
      → [در همان تراکنش دامنه] StockLedgerEntry(OUT از رزرو consumed) + JournalEntry(فروش)
      → Notification(مشتری)
```
- **انبار:** رزرو در لحظه Order؛ تخصیص (consumed) در لحظه verify موفق. انقضای پرداخت → release رزرو (بند ۲۳).
- **حسابداری:** فقط در verify موفق؛ سند از `accountingMapping` کانال؛ idempotencyKey واحد برای کل زنجیره (بند ۴۷).
- **کارت‌به‌کارت (بند ۴۸):** attempt → submission(pending_verification) → admin review → approved → همان زنجیره verify. رد/correction → بدون سفارش جدید، تاریخچه می‌ماند.

## ۶) ERD تکمیلی (بند ۵۵.۱۰) — فقط مدل‌های جدید/تغییریافته

```prisma
PaymentMethod   {id, code UQ, nameInternal, namePublic, description?, iconMediaId?, active,
                 sortOrder, supportedChannelIds[], minAmount?, maxAmount?,
                 customerInstructions?, adminInstructions?, config Json(secure)}
PaymentProvider {id, provider(code), name, env, active, priority, minAmount?, maxAmount?,
                 credentialsEncrypted, callbackUrl?, methodIds[]}
PaymentAttempt  {id UQ, orderId?, posInvoiceId?, methodId, providerId?, channelId,
                 amount, state(13 حالت بند ۸), idempotencyKey UQ,
                 providerTxId? UQ, authority?, callbackAt?, verifiedAt?, failReason?,
                 expiresAt?, audit JSONB(ترنزیشن‌ها)}
CardToCardAccount {id, bankName, holderName, cardNumber, iban?, accountNumber?,
                 displayTitle?, logoMediaId?, customerInstructions?, visibleFields JSONB,
                 active, sortOrder}
CardToCardSubmission {id, attemptId, amount, transferDate?, transferTime?, sourceBank?,
                 destAccountId, referenceNo?, sourceCardLast4?, note?,
                 receiptAttachmentId?, state(pending_verification|under_review|approved|
                 rejected|correction_required|expired|cancelled), decidedById?, decidedAt?,
                 decisionNote?, UQ(referenceNo,destAccountId) جلوگیری از تکرار بند ۲۲}
PaymentReconciliation {id, attemptId?, providerTxId?, settlementAmount, settlementDate?,
                 status(unmatched|matched|partially_matched|reconciled|disputed), note?}
TrustBadge {id, internalName, displayTitle?, description?, imageMediaId?, icon?,
             verificationUrl, altText?, active, sortOrder, openInNewTab, rel?,
             placement(footer_trust|checkout), createdAt, updatedAt}
FooterSection/… → از Menu موجود + TrustBadge.placement (بدون entity موازی)
```

## ۷) API جدید (بند ۵۰ — خلاصه)

عمومی: `GET /payment-methods?channel=`, `GET /footer-config` (sections+badges+payment-logos، فقط فیلدهای امن، order=sortOrder)
مشتری: `POST /orders/:id/payment-attempts` · `POST /payment-attempts/:id/card2card-submission` (+receipt upload validate) · `GET /payment-attempts/:id` · `POST /payment-attempts/:id/retry`
ادمین RBAC: `POST /admin/payment-attempts/:id/verify|approve-c2c|reject-c2c|request-correction` · `POST /admin/refunds` · `POST /admin/reconciliation/match` · CRUD `payment-methods|providers|c2c-accounts|trust-badges` (Super Admin) · `GET /admin/payment-reports`
وبوک: `POST /payments/:provider/callback` → WebhookEvent + verify + idempotent

## ۸) RBAC جدید (بند ۵۱)

`payments.read` · `payments.verify` · `c2c.approve` (Accountant/Manager) · `payments.refund` (Cashier محدود با سقف، Manager کامل) · `payments.reconcile` (Accountant) · `payments.configure` + `trust.manage` (فقط Super Admin)

## ۹) نقشه راه به‌روزشده (بند ۵۴ — جایگزین فاز ۴ و تکمیلی)

```
فاز 4a  Payment domain (Method/Provider/Attempt + state machine + idempotency)
فاز 4b  درگاه آنلاین (زرین‌پال) + callback/verify/retry
فاز 4c  Checkout/Payment فرانت + صفحات موفق/خطا (CTA مبلغ‌دار)
فاز 4d  کارت‌به‌کارت (accounts/submission/receipt/verification workflow)
فاز 4e  Refund integration + Reconciliation
فاز 4f  گزارش‌های پرداخت
فاز 9+  TrustBadge backend + Footer config API + رندر عمومی فوتر (جایگزین فوتر هاردکد فعلی)
```

## ۱۰) تست‌های الزامی جدید (بند ۵۲)

- state machine: هر ترنزیشن نامعتبر رد شود؛ duplicate callback → یک paid
- c2c: duplicate reference؛ expiry → release رزرو؛ approval بدون permission → 403
- refund: partial/full؛ دوبار refund ممنوع (idempotencyKey)
- trust: بج غیرفعال رندر نشود؛ صفر بج = بدون container؛ rel سخت‌گیرانه برای target=_blank

## ۱۲) تصمیم‌های نهایی تاییدشده

| # | تصمیم | انتخاب |
|---|---|---|
| 1 | تایمینگ انبار | **کسر در verify درگاه**: ثبت Order → رزرو (Available کاهش، OnHand ثابت) → verify قطعی → Reservation=CONSUMED + Sale Movement + COGS + سند حسابداری + Order=PAID، همه در یک تراکنش اتمیک. Available = OnHand − Reserved. شکست/انقضا → آزادسازی رزرو، بدون Sale/COGS. Callback هرگز معیار موفقیت نیست؛ verify S2S الزامی؛ idempotency در مصرف رزرو و سند حسابداری. Job بررسی وضعیت‌های مبهم (timeout) با TTL رزرو. POS نیز همین Source of Truth |
| 2 | اقساطی | **Abstraction آماده، provider غیرفعال در V1**: PaymentProvider Interface با createPayment/verify/refund/reconciliation؛ ZarinPal فعال؛ Installment به‌صورت PaymentMethod type=installment ولی disabled؛ فیلدهای آینده (plan/count/fee/commission/settlement) در مدل پیش‌بینی شده؛ تغییرات آینده فقط در Adapter — Business Logic عمومی دست نمی‌خورد؛ هیچ ادعای فعال بودن اقساطی در V1 |
| 3 | رسید c2c | **اختیاری** (jpg/png/webp/pdf + validate محتوایی، non-public URL)؛ اجبار قابل پیکربندی بعداً |

## ۱۱) مرور امنیتی (بند ۵۳)

credentials رمز + هرگز در پاسخ API؛ callback فقط با WebhookEvent(idempotent+verify)؛ رسید آپلودی validate محتوایی + non-public URL؛ IDOR روی submission (مالکیت سفارش)؛ URL بج‌ها sanitize (فقط http/https) + rel noopener noreferrer؛ XSS: هیچ HTML خام در بج‌ها — embed code نیازمند مکانیزم کنترل‌شده در آینده.
