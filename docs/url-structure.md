# ساختار URL قاصدک — سند قفل (گام ۲۰)

> **این سند «قفل» است.** هر تغییر URL بعد از این تاریخ باید با ریدایرکت ۳۰۱ دائمی انجام شود
> و در همین فایل ثبت گردد. ساختار قبل از لانچ قطعی شد چون بعد از ایندکس‌شدن در
> موتورهای جست‌وجو، تغییر URL گران‌ترین کار ممکن است.

## ۱. دامنه

| قاعده | مقدار |
|---|---|
| دامنهٔ کانونیکال | `https://www.lebaszirghasedak.ir` (با www) |
| ریدایرکت | apex (`lebaszirghasedak.ir`) ← **۳۰۱ دائمی** به www — در middleware فروشگاه **و** در reverse-proxy سرور (nginx/caddy) |
| پایان‌اسلش | **ندارد** (سیاست پیش‌فرض Next). مسیرهای `/path/` با **۳۰۸** به `/path` می‌روند؛ ریشهٔ سایت استثناست |
| متغیر محیطی | `CANONICAL_HOST` (پیش‌فرض `www.lebaszirghasedak.ir`) — برای تست‌پذیری |

همهٔ canonicalها، sitemap و دادهٔ ساخت‌یافته از `SITE_URL` در `apps/storefront/lib/site.ts` می‌آیند؛
هیچ جای دیگری دامنه هاردکد نمی‌شود.

## ۲. الگوی مسیرها

| نوع صفحه | الگو | نمونه |
|---|---|---|
| محصول | `/p/[slug]` | `/p/ست-سوتین-و-شورت-پنبه-ای` |
| دسته | `/c/[slug]` | `/c/bra` |
| راهنما | `/guides/[slug]` | `/guides/size` |
| صفحهٔ CMS (صفحه‌ساز) | `/[slug]` | `/کمپین-تابستان` |
| صفحه‌های ثابت سایت | `/about`, `/contact`, `/terms`, `/privacy`, `/returns`, `/shipping` | — |
| جست‌وجو/نیاز | `/search?q=…`, `/need`, `/need/result?a0=…` | — |
| سبد/سفارش/حساب | `/cart`, `/checkout`, `/checkout/pay`, `/order/[code]`, `/account`, `/track`, `/wishlist` | این‌ها noindex هستند |

## ۳. قواعد اسلاگ فارسی (تک‌منبع: `packages/contracts/src/persian.ts`)

1. نرمال‌سازی: `ي` عربی→`ی`، `ك` عربی→`ک`، ارقام عربی/فارسی→لاتین، حذف کاراکترهای کنترلی،
   یکسان‌سازی فاصله‌ها. **نیم‌فاصله در ذخیره حفظ می‌شود**؛ فقط برای تطبیق جست‌وجو نسخهٔ «فاصله‌شده» ساخته می‌شود.
2. `slugifyFa`: فاصله و نیم‌فاصله → `-`؛ حذف `-` تکراری، ابتدا و انتها؛ حروف لاتین کوچک؛
   فقط `[a-z0-9\u0600-\u06FF-]` مجاز است؛ نتیجهٔ خالی → fallback فراخواننده.
3. **اسلاگ دستیِ مدیر**: با نرمال‌سازی ذخیره می‌شود؛ تکرار ← خطای ۴۰۹ `SLUG_DUPLICATE`؛
   رزرو بودن ← خطای ۴۰۹ `SLUG_RESERVED` (پیام فارسی صریح).
4. **اسلاگ خودکار**: پس‌وند `-۲`، `-۳`، … می‌گیرد (`ensureUniqueSlug`).
5. اسلاگِ موجودیت تغییرناپذیر است؛ تغییر آن یعنی صفحهٔ تازه (قاعدهٔ قدیمی CMS).

## ۴. اسلاگ‌های رزرو

از `RESERVED_SLUGS` (همان ماژول) — هیچ محصول/دسته/صفحه‌ای نباید اینها را بگیرد:

```
about, account, admin, api, c, cart, checkout, contact, guides, need, og-fonts,
order, p, pos, privacy, returns, search, shipping, terms, track, wishlist
```

**استثنا:** صفحه‌های محتواییِ خودِ سایت (`home`, `about`, `contact`, `returns`, `shipping`,
`privacy`, `terms`) منبعشان همان CMS است؛ برای CMS فقط بقیهٔ مسیرها رزرو محسوب می‌شوند
(`CmsService.RESERVED_FOR_CMS`).

## ۵. سیاست ریدایرکت‌ها

| وضعیت | کد | مقصد |
|---|---|---|
| apex → www (فقط production) | ۳۰۱ | `https://www.lebaszirghasedak.ir<path><query>` |
| `/path/` → `/path` (غیر از ریشه) | ۳۰۸ | همان میزبان، بدون پایان‌اسلش |
| اسلاگ تغییریافتهٔ موجودیت | ۳۰۱ | صفحهٔ جدید — فقط با ثبت در همین سند |

## ۶. متادیتا و دادهٔ ساخت‌یافته

- هر صفحهٔ ایندکس‌شده `alternates.canonical` بدون پایان‌اسلش دارد (محصول/دسته/راهنما/CMS/صفحه‌های محتوایی/نیاز/جست‌وجو).
- صفحهٔ محصول: JSON-LD `Product` (نام/برند/تصویر مطلق/`offers` با `IRR` و موجودی از واریانت‌ها/`aggregateRating` فقط با نظر واقعی).
- صفحهٔ دسته: JSON-LD `ItemList` + `BreadcrumbList`.
- ریشه: JSON-LD `Organization` + `WebSite` با `SearchAction` به `/search?q={search_term_string}`.
- `/sitemap.xml`: صفحه‌های CMS منتشرشده (از `GET /api/v1/cms/pages`) + محصولات + دسته‌ها + راهنماها؛ `/robots.txt` مسیرهای کاربردی را noindex نگه می‌دارد.
