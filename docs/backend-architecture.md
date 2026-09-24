# گزارش معماری Backend و پنل مدیریت — لباس زیر قاصدک

> طبق بند ۱۱۰ spec بک‌اند: پیش از تولید کد، این گزارش تایید شود.
> مکمل `docs/architecture-v2.md` (فرانت). هیچ قاعده کسب‌وکاری اختراع نشده است.

---

## ۱) استک پیشنهادی (بند ۳) و دلیل

| لایه | انتخاب | دلیل فنی |
|---|---|---|
| Runtime/زبان | Node.js 22 + TypeScript | هم‌زبان با فرانت → **DTO های مشترک** (بند ۱۰۹) با یک package `@ghasedak/contracts` |
| فریم‌ورک API | **NestJS 10** | ماژولارِ بند ۱۰۸ به‌صورت بومی (Module/Provider/Guard/Interceptor)؛ DI و RBAC گارد-محور؛ جامعه بزرگ فارسی‌زبان |
| ORM | **Drizzle + postgres.js** | Migration تایپ‌دار (بند ۹۱)؛ SQL شفاف برای فیلتر OR/AND پیچیده (بند ۲۳) |
| DB | **PostgreSQL 16** | Relational الزامی (بند ۴)؛ تراکنش برای سفارش/موجودی (بند ۹۵)؛ pg_trgm برای جستجو (بند ۶۳) |
| Cache/Queue | **Redis 7** + BullMQ | Cache بند ۶۲ + Jobهای بند ۸۷ (ایمیل/اس‌ام‌اس/پردازش تصویر/بنر زمان‌بندی‌شده) |
| Storage | S3-سازگار abstraction (آروان/MinIO)؛ Local در dev | بند ۶۰ — پیاده‌سازی هاردکد نمی‌شود |
| Auth ادمین | Session cookie امن (httpOnly) + argon2id | پنل یک‌دمینی → Session ساده‌تر و امن‌تر از JWT در localStorage؛ CSRF دوبل‌توکن (بند ۵۸) |
| Auth مشتری | OTP موبایل + JWT کوتاه/Refresh rotation | ورود بی‌رمزِ رایج ایران؛ Guest بند ۴۰ بدون حساب |
| مستندات | OpenAPI از روی Zod DTO | بند ۸۹ |
| Deployment | Docker Compose (api, db, redis, minio) → سرور تک | بند ۹۴؛ سادگی بند ۶۴ |

عدم انتخاب: Medusa/Saleor (فارسی‌سازی و RBAC و فارسی-سلاگ را مجبور به override سنگین می‌کنند)، میکروسرویس (بند ۶۴: ممنوع در این مقیاس)، MongoDB (سفارش/موجودی رابطه‌ای است).

## ۲) معماری سیستم

```
Storefront (Next.js)          Admin Panel (Next.js /admin)
        └──────────┬───────────────────┘
              REST API (NestJS)
   ┌───────────┼─────────────┐
Public API    Admin API     Webhook API (درگاه)
   └───────────┼─────────────┘
        Business Logic (Services)
   ┌───────────┼──────────────┐
 PostgreSQL   Redis          Storage(S3) + SMS/Email Providers
```

- همه‌چیز از Service عبور می‌کند؛ ادمین مستقیماً DB را لمس نمی‌کند (بند ۲).
- ماژول‌ها دقیقاً مطابق فهرست بند ۱۰۸ (۲۸ ماژول).
- Contract مشترک: `packages/contracts` = Zod schema + تایپ، مصرف مشترک فرانت/بک/ادمین.

## ۳) ERD (خلاصه؛ فیلدهای کلیدی)

```
users(id, mobile?, email?, passwordHash?, name, role, status, lastLoginAt, createdAt, updatedAt)
sessions(id, userId, tokenHash, ip, userAgent, expiresAt)
permissions / role_permissions        ← granular بند ۵۷/۱۰۳

categories(id, parentId?, name, slug UNIQUE, description, imageId?, iconId?, bannerId?,
           sortOrder, status, seoId?, createdAt, updatedAt, deletedAt?)
category_attributes(categoryId, attributeId, isFilterable, displayGroup, sortOrder)  ← بند ۱۰/۱۷
  displayGroup = «نوع سوتین» فقط رشته نمایشی است؛ داده مستقل می‌ماند (بند ۸)

brands(id, name, slug UNIQUE, logoId?, description, bannerId?, website, status, sortOrder, seoId?, …)

attributes(id, name, slug UNIQUE, type[select|multi|color|number|boolean|text],
           isFilterable, isSearchable, isVariantAxis, showOnCard, showOnProduct, showInAdmin)
attribute_terms(id, attributeId, value, slug, hex?, swatchImageId?, sortOrder)   ← بند ۲۴

products(id, name, slug UNIQUE, shortDescription, description, status[draft|published|archived],
         categoryId, brandId?, basePrice, salePrice?, saleStartsAt?, saleEndsAt?, costPrice?,
         videoUrl?, weightGrams?, publishedAt?, seoId?, faqScopeId?, …)
product_tags(product_id, tag)
product_attributes(product_id, attributeTermId)          ← جنس و بقیه سطح محصول
product_images(product_id, mediaId, alt, sortOrder, isPrimary)

product_variants(id, productId, sku UNIQUE, barcode UNIQUE?, price, salePrice?,
                 stockQty, reservedQty, lowStockThreshold, status, weightGrams?,
                 imageId?, createdAt, updatedAt, deletedAt?)
variant_terms(variantId, attributeTermId)                ← رنگ/سایز/کاپ/فنر/اسفنج … (بند ۶/۸)
  · قید UNIQUE روی (productId, مجموع ترم‌های variant-axis) → جلوگیری از واریانت تکراری
  · سازگاری ترکیبی = EXISTS روی variant_terms — همان منطقی که فرانت اکنون دارد

inventory_movements(id, variantId, delta, reason[purchase|order|manual|return|adjust],
                    refId?, actorId?, note, createdAt)   ← بند ۲۸

carts(id, token UNIQUE (کوکی مهمان), customerId?, status, createdAt, updatedAt)
cart_items(id, cartId, variantId, qty, unitPriceSnapshot)  ← قیمت لحظه سفارش‌گذاری

orders(id, code UNIQUE, customerId?, guestContact{mobile,name}, addressSnapshot JSONB,
       status, subtotal, shippingCost, discountTotal, total, currency,
       paymentStatus, shippingMethodSnapshot, trackingCode?, notes?, createdAt, updatedAt)
order_items(id, orderId, variantId?, titleSnapshot, variantTermsSnapshot JSONB,
            qty, unitPrice, salePrice?, lineTotal)        ← snapshot بند ۴۰/۹۶
order_status_history(id, orderId, fromStatus, toStatus, actorId?, note, createdAt)  ← بند ۳۲
order_events(id, orderId, type, payload JSONB, idempotencyKey UNIQUE)  ← وبوک بند ۳۷

customers(id, userId?, mobile UNIQUE, name, email?, notes, status, totalSpentCache, ordersCount, firstOrderAt, lastOrderAt)
addresses(id, customerId?, provinceId, cityId, line, postalCode, plaque, unit, isDefault)

provinces(id, name, slug)  cities(id, provinceId, name, slug)   ← بند ۳۴ (قابل مدیریت)

shipping_zones(id, name, provinceIds?[], status)
shipping_methods(id, zoneId, name, cost, freeOverAmount?, etaText, sortOrder, status)  ← بند ۳۳

payment_gateways(id, provider[zarinpal|…], name, env, configEncrypted, callbackUrl, sortOrder, status)  ← بند ۳۵
payments(id, orderId, gatewayId, amount, authority?, refId?, status, rawPayload JSONB, createdAt)

coupons(id, code UNIQUE, type[percent|fixed], amount, startsAt, endsAt, usageLimit,
        perCustomerLimit, minCartTotal, maxDiscount, appliesTo JSONB, excludes JSONB, active)  ← بند ۳۸
coupon_redemptions(couponId, orderId, customerId?, mobile)

reviews(id, productId, customerId?, mobile?, name, rating, body, status[pending|approved|rejected|hidden],
        isVerifiedPurchase, adminReply?, createdAt)        ← بند ۴۱ (هیچ fake seed ممنوع)

media(id, kind[image|video|doc], storageKey, mime, sizeBytes, width?, height?,
      alt?, title?, caption?, focalX?, focalY?, variants JSONB[thumb/md/lg/webp/avif], createdAt)  ← بند ۱۲

cms_pages(slug, payload JSONB, status[draft|published], publishedAt?, revisionOf?, updatedBy)
home_sections(id, type[hero|carousel|grid|categories|brands|banner|guides|trust|need_finder|richtext|newsletter],
              config JSONB, sortOrder, enabled, publishStatus)            ← بند ۱۵/۱۶
content_revisions(entity, entityId, payload JSONB, actorId, createdAt)      ← بند ۷۰

heroes(id, title, subtitle, description, ctaText, ctaHref, desktopImageId, mobileImageId,
       pins JSONB[{x,y,slug,tip}], active)                                  ← بند ۱۴ + پین‌های فعلی فرانت

need_finder_steps(id, question, sortOrder, active)
need_finder_options(id, stepId, label, icon?, imageId?, sortOrder, active,
                    rule JSONB{categories?, attributeTerms?, priceMax?})    ← بند ۱۹/۲۰

faqs(id, scope[global|category|product], scopeId?, question, answer, sortOrder, active)  ← بند ۴۳
size_guides(id, title, description, instructions, tables JSONB, imageId?, categoryId?)   ← بند ۴۴
contents(key[shipping|returns|exchange|care], payload JSONB)                ← بند ۴۵

seo_meta(id, seoTitle, metaDescription, canonical?, ogTitle?, ogDescription?, ogImageId?, noindex, inSitemap)  ← بند ۴۶
slug_redirects(oldSlug, newSlug, createdAt)                                 ← بند ۴۷

menus(id, position[header|mobile|footer], name)  menu_items(id, menuId, parentId?, title, url, iconId?, sortOrder, active, openIn)  ← بند ۴۸/۴۹
banners(id, title, subtitle?, desktopImageId, mobileImageId?, ctaText, ctaHref,
        startsAt?, endsAt?, priority, active)                               ← بند ۸۲/۸۳

settings(key PK, value JSONB, updatedBy?, updatedAt)                        ← بند ۵۰ (store/contact/currency/tz/…)
design_tokens(key PK, value)                                                ← بند ۸۰ (کنترل‌شده)

admin_users → از users با role | audit_logs(id, actorId, action, entity, entityId,
             oldValues JSONB?, newValues JSONB?, ip?, createdAt)            ← بند ۵۶/۱۰۴

notifications(id, channel[email|sms|inapp|admin], templateKey, to, payload JSONB, status, sentAt?)  ← بند ۵۱
sms_templates / email_templates(key, subject?, body, vars JSONB)            ← بند ۵۲/۸۶
events(id, name[product_view|add_to_cart|…], sessionKey?, payload JSONB, createdAt)  ← بند ۵۵
return_requests(id, orderId, items JSONB, reason, status, notes, createdAt) ← بند ۸۴
```

**نکته درهم‌تنیدگی:** `product_variants` + `variant_terms` همان قراردادی است که فرانت اکنون با `VariantV2` دارد → لایه repo فرانت فقط منبع عوض می‌کند.

## ۴) API

Public `GET /api/v1/...`: products (فیلتر/سورت/صفحه‌بندی), product/:slug, categories, brands, attributes-per-category, home (بخش‌های فعال), need-finder (steps + match), search, settings/public, guides, faqs, menu, banners.
Customer `POST /api/v1/auth/otp…`, `cart`, `wishlist`, `orders`, `reviews`, `returns`.
Admin `/api/v1/admin/...` با گارد Session+RBAC: CRUD کامل + مسیرهای عملیاتی: `variants/generate`, `inventory/adjust`, `orders/:id/status`, `payments/verify`, `cms/home:publish|preview`, `media/upload`, `reports/*`, `settings`, `users`, `audit`.
Webhook `/api/v1/payments/:provider/callback` با verify + idempotencyKey (بند ۳۷/۹۵).
Error یکسان بند ۶۵: `{ code, message, fieldErrors?, requestId }`؛ صفحه‌بندی بند ۶۶: `?page&limit&sort`.

## ۵) Auth و RBAC (بند ۵۷/۱۰۳)

- Admin: argon2id + session httpOnly + rotation؛ CSRF token؛ rate-limit per-IP/user.
- Customer: OTP موبایل (کد ۶ رقمی، TTL ۲ دقیقه، محدودیت تلاش) + JWT ۱۵د + refresh rotation.
- Permissionها granular مثل `products.publish`؛ Guard از روی decorator خوانده می‌شود؛ جدول role_permissions قابل مدیریت از پنل.

## ۶) Media (بند ۱۲/۱۳/۵۹–۶۱)

آپلود → validate (extension+MIME+magic bytes+size) → ذخیره اصلی در S3 → Job پردازش (thumb/md/lg + webp/avif) → رکورد media. SVG فقط با sanitize. نام ذخیره‌سازی تولیدی (uuid)، هیچ‌وقت نام کاربر. همه تصاویر سایت از `media` سرو می‌شوند؛ Hero/Banner/دسته/برند فقط mediaId نگه می‌دارند.

## ۷) CMS (بند ۱۴–۱۶/۷۱–۷۲)

`home_sections` با typeهای محدود (نه page-builder باز)؛ پیش‌نمایش با `?preview=<token>` روی draft؛ publish نسخه در `content_revisions` ثبت می‌کند. Best Sellers/New: `mode: auto|manual` — auto فقط با داده فروش واقعی؛ بدون داده → سکشن خالی/مخفی (بند ۱۷/۱۸ و قاعده «بدون جعل»).

## ۸)پنل ادمین (بند ۷۳–۷۹/۱۰۵)

Next.js جدا از فرانت فروشگاه در همان ریپو (`apps/admin` یا `/admin`)، فارسی/RTL/دسکتاپ‌اول. منو مطابق بند ۷۳. جدول‌ها sortable/searchable/paginated (بند ۷۵). ساخت محصول مرحله‌ای بند ۷۶ + **Variation Builder** بند ۷۷ با گارد انفجار ترکیب بند ۷۸ (هشدار >۶۰، تولید فقط ترکیب‌های انتخابی، exclude ترکیب). عملیات خطرناک = dialog تایید + ثبت audit.

## ۹) Deployment / Observability (بند ۸۸/۹۳/۹۴)

Docker Compose dev؛ staging/prod با env. `.env.example` بدون ریسک. structured log + requestId + healthcheck (`/health`: db, redis, storage). Backup: pg_dump روزانه + نسخه‌برداری bucket؛ هرگز public.

## ۱۰) تست (بند ۹۰)

Unit (services) + Integration (API + DB واقعی در Docker) + E2E فلوی بحرانی فهرست بند ۹۰. Contract test با schemaهای Zod مشترک. Seed دمو فقط با env `SEED_DEMO=true` و برچسب صریح (بند ۹۲).

## ۱۱) فازها (بند ۱۱۱ — قابل شروع پس از تایید)

Foundation → Auth+RBAC → DB/Migrations → Products/Variants → Categories/Brands/Attributes → Media → Inventory → Search/Filters → CMS/Home → Orders → Customers → Shipping → Payment → Coupons → Reviews/Wishlist → SizeGuide/NeedFinder → Notifications → Reports/Analytics → SEO → Security/Perf → Testing → Deploy.

---

## تصمیم‌های گم‌شده / سوالات تایید (بند ۱۱۰)

1. **دروگاهOTP مشتری:** شماره‌ای مثل Kavenegar؟ (بند ۵۲ — فقط انتخاب provider، بعداً قابل تعویض)
2. **درگاه اقساطی خاص** مدنظر هست (اسنپ‌پی/تارا/…؟) یا فقط زرین‌پال در V1 با abstraction؟
3. **مونو‌ریپو:** `apps/storefront` + `apps/admin` + `apps/api` + `packages/contracts` — موافق؟ (فرانت فعلی به `apps/storefront` منتقل می‌شود)
4. **زبان رابط ادمین:** کاملاً فارسی (پیشنهاد) یا دوزبانه؟
5. **قیمت:** تومان صحیح در DB (پیشنهاد؛ بدون ریال/اعشار) — تایید؟

---

## تصمیم‌های نهایی تاییدشده (ثبت‌شده)

| # | تصمیم | انتخاب نهایی |
|---|---|---|
| 1 | احراز مشتری | **OTP با کاوه‌نگار** (Kavenegar) از طریق Provider Abstraction اعلان‌ها (بند ۵۱) — قابل تعویض بدون تغییر Business Logic |
| 2 | درگاه پرداخت | **زرین‌پال در V1** با Gateway Abstraction از ابتدا (بند ۳۶) — درگاه اقساطی بعداً به‌عنوان Provider جدید اضافه می‌شود |
| 3 | ساختار ریپو | **مونوریپو pnpm + Turborepo**: `apps/storefront` (مهاجرت‌یافته), `apps/api`, `apps/admin` (فاز بعدی), `packages/contracts`, `packages/database`, `packages/utils` |
| 4 | زبان ادمین | **کاملاً فارسی** |
| 5 | مدل مالی | **تومان صحیح (IRT، BigInt)** + `packages/contracts/src/money.ts` به‌عنوان تنها نقطه محاسبات مالی — بدون float، تبدیل فقط در لایه مرکزی درگاه/حسابداری |

> ORM: گزارش ابتدا Drizzle را پیشنهاد داده بود؛ در پیاده‌سازی Phase 1 از **Prisma 6** استفاده شد (زمان کمتر تا migration اول، client type-safe، و sync آسان‌تر این ریپو) — مدل دیتابیس و ERD تغییری نکرده است.
