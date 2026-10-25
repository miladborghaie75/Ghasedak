# بریف اجرای موازی — موج ۱ گام‌های باقی‌مانده قبل از لانچ

> **این سند خودکفاست.** همهٔ زمینه، تصمیم‌ها، فایل‌ها، الزامات و معیارهای پذیرش لازم داخل همین فایل آمده؛ به هیچ گفتگو یا سند دیگری وابسته نیست.
>
> **نحوهٔ اجرا:** این بریف شامل **سه بستهٔ کاری مستقل** است (بستهٔ A، بستهٔ B، بستهٔ C). هر سه را **همزمان و در یک اجرا** انجام بده. لازم نیست مرحله‌به‌مرحله یا یکی‌یکی پیش بروی؛ تداخل فایلی بینشان وجود ندارد. فقط قواعد بخش «اجرا و هماهنگی موازی» را رعایت کن. وقتی هر سه بسته تمام شد، کار تمام است.
>
> **خارج از دامنه (فقط این‌ها را انجام نده):** گام ۲۱ (کارایی)، گام ۱۸-۳ (چت‌بات)، 2FA نقش‌های مالی (بعد از لانچ).

---

## زمینهٔ پروژه

- مونوریپوی pnpm به نام «قاصدک» با سه اپ:
  - `apps/storefront` — فروشگاه Next.js (App Router، RTL فارسی، آدرس‌های `/p/[slug]` محصول، `/c/[slug]` دسته، `/[slug]` صفحات CMS).
  - `apps/admin` — پنل ادمین Next.js.
  - `apps/api` — بک‌اند NestJS + Prisma (`packages/database`).
- پکیج‌های مشترک: `packages/contracts`، `packages/blocks`، `packages/database`، `packages/copy-rules`.
- مدیریت پکیج: pnpm؛ اجرای تست/بررسی کل مخزن: `pnpm typecheck` از ریشه و تست‌های Jest در `apps/api` (پیکربندی `apps/api/jest.config.js`).
- برند/دامنه: فروشگاه لباس زیر زنانه «لباس زیر قاصدک» — دامنهٔ رسمی: `lebaszirghasedak.ir`.

### وضعیت فعلی کد (واقعی — بازبینی شده)

- `apps/storefront/lib/site.ts` → `SITE_URL = "https://lebaszirghasedak.ir"` — **بدون www**. باید به www برود (تصمیم قطع‌شدهٔ #۴).
- `apps/storefront/middleware.ts` → CSRF فروشگاه از قبل با الگوی double-submit پیاده شده (کوکی `csrf_token` + هدر `x-csrf-token`).
- `apps/api/src/auth/auth.service.ts` → هش رمز فعلاً scrypt است؛ فرمت ذخیره‌شده در `User.passwordHash` دقیقاً `scrypt$salt$hash` است (بدون `$` پیشوندی — scheme با متن ساده).
- `apps/storefront/app/robots.ts` و `apps/storefront/app/sitemap.ts` → موجود و کار می‌کنند ولی sitemap فقط صفحه‌های هاردکد + محصولات را می‌دهد؛ صفحات CMS داینامیک (`/[slug]`) را از API نمی‌گیرد.
- `apps/storefront/lib/catalog-repo.ts` → تابع `searchV2(q, pool)` جست‌وجوی سادهٔ `includes` روی `name`/`short` است؛ هیچ نرمال‌سازی فارسی/مترادفی ندارد.
- `apps/api/src/common/background-workers.ts` → فقط تابع `backgroundWorkersEnabled()` (گیت روشن/خاموش workerها با `GHASEDAK_WORKERS`)؛ heartbeat/مانیتورینگ ندارد.
- `apps/api/src/events/` → event-bus، notification-dispatcher (ایمیل/پیامک)، sms-providers — زیرساخت اعلان موجود. **در Settings ادمین هیچ تنظیم تلگرامی وجود ندارد** و sms-providers گزارش اعتبار (credit) نمی‌دهد — هشدار تلگرام باید با env ست شود (بند C2).
- **argon2 از قبل نصب است:** `"argon2": "^0.45.1"` در `apps/api/package.json` و `argon2@0.45.1` در node_modules — هیچ وابستگی جدیدی برای بستهٔ B لازم نیست.
- **Endpoint سلامت از قبل وجود دارد:** `apps/api/src/health/` (`health.controller.ts` + `health.service.ts`) روی `GET /api/v1/health` — ولی چون `redis` و `storage` در سرویس hardcode شده‌اند `false`، status همیشه `degraded` است حتی وقتی DB سبز است. بستهٔ C همین سرویس را اصلاح می‌کند؛ **سرویس/controller دوم نساز**.
- **وضعیت واقعی CSRF فروشگاه:** چک double-submit فقط در `app/api/checkout/route.ts`، `app/api/pay/start/route.ts`، `app/api/analytics/visit/route.ts`، `app/api/analytics/consent/route.ts` هست. routeهای `cart/route.ts`، `cart/items/route.ts`، `cart/items/[variantId]/route.ts` و `reviews/route.ts` (همهٔ متدهای مینت) **چک ندارند** و کلاینتهایشان (CartProvider/CartClient، ReviewForm) هدر `x-csrf-token` را هم نمی‌فرستند. `pay/callback` فراخوانی سرور-به-سرور درگاه است — CSRF رویش اعمال نمی‌شود (صحت‌سنجی امضای درگاه مرتبط است، جدا از این بسته). جزئیات در B2.

### تصمیم‌های قطع‌شده (باید همین‌طور پیاده شوند)

- **#۳:** اسلاگ‌ها فارسی می‌مانند ولی با نرمال‌سازی استاندارد.
- **#۴:** دامنهٔ کانونیکال `https://www.lebaszirghasedak.ir` است؛ ریدایرکت ۳۰۱ دائمی از apex (و هر هاست غیرکانونیکال) به www.
- **#۷:** مانیتورینگ = uptime + هشدار تلگرام/ایمیل (بدون افزودن SaaS جدید بدون تأیید صاحب پروژه).
- **#۹:** 2FA بعد از لانچ — در این بریف نیست.
- **#۱۰/#۱۵:** چت‌بات گام ۱۸-۳ در موج بعدی است — در این بریف نیست.

---

## اجرا و هماهنگی موازی (الزام‌ها)

1. **هم‌زمانی:** بسته‌های A، B، C همزمان اجرا می‌شوند. اگر با چند agent/گروه کاری اجرا می‌کنی، هر بسته را به یک مسیر مستقل بسپار.
2. **Migration دیتابیس:** اگر بیش از یک بسته نیاز به migration داشت (احتمالاً فقط بستهٔ C ممکن است نیاز داشته باشد؛ A و B نباید تغییر schema بخواهند — اگر خلافش را دیدی، قبل از هر کاری بازطراحی کن که به migration نیاز نباشد)، همهٔ migrationها را **ترتیبی و از یک مسیر واحد** با تایم‌استمپ‌های صعودی بدون تداخل بساز و اعمال کن. هرگز دو migration هم‌تاریخ نساز.
3. **تداخل فایل‌ها:** بستهٔ A عملاً فقط storefront + slug در API/ادمین را لمس می‌کند؛ بستهٔ B فقط `apps/api/src/auth` و تست‌های آن؛ بستهٔ C فقط `apps/api` (events/common) و اسکریپت‌ها. اگر لازم شد فایلی بین دو بسته تغییر کند، تغییرها را یکجا اعمال کن و در گزارش ذکر کن.
4. **تست و بررسی نهایی:** بعد از اتمام هر سه بسته، از ریشهٔ مخزن `pnpm typecheck` و تست‌های `apps/api` باید سبز شوند. هیچ تستی را ضعیف‌تر نکن؛ اگر تستی شکست خورد علتش را درست کن.
5. **زبان و سبک کد:** کامنت‌ها و متن‌های کاربر فارسی، سبک کد مطابق فایل‌های همسایه (فونت/توکن‌ها/UI موجود را تغییر نده — این بریف طراحی بصری ندارد).
6. **هیچ dependency جدید بدون نیاز واقعی اضافه نکن.** برief بازبینی‌شده: argon2 از قبل نصب است و برای هیچ‌کدام از سه بسته وابستگی جدیدی لازم نیست؛ اگر در جایی واقعاً ناچار شدی، در `package.json` همان اپ اضافه شود و در گزارش پایانی صریح ذکر کن (و اگر native build دارد، در `pnpm.onlyBuiltDependencies` ریشه ثبت شود).

---

## بستهٔ A — گام ۲۰: SEO + قفل ساختار URL + جست‌وجوی فارسی (اندازه M)

**هدف:** ساختار URL قبل از لانچ قطعی و قفل شود (بعداً تغییرش برای SEO گران است)، و جست‌وجوی فارسی قابل‌اعتماد شود.

### A1. توابع مشترک نرمال‌سازی و slugify فارسی

در `packages/contracts` (تک‌منبع برای storefront/ادمین/API) یک ماژول جدید بساز (مثلاً `src/persian.ts`) شامل:

- `normalizePersian(s)`: تبدیل `ي→ی`، `ك→ک`، ارقام عربی/فارسی→لاتین، حذف کاراکترهای کنترلی، یکسان‌سازی فاصله‌ها و نیم‌فاصله (U+200C) — نیم‌فاصله را **حذف نکن**، فقط برای matching یک نسخهٔ «فاصله‌شده» هم بده.
- `slugifyFa(input)`: نام فارسی → اسلاگ امن URL (پرینت‌پذیر باقی بماند؛ نیم‌فاصله → `-` یا حذف مطابق الگوی موجود اسلاگ‌های seed؛ فاصله→`-`؛ حذف `-` تکراری ابتدا/انتها؛ lowercase لاتین‌ها).
- **لیست اسلاگ‌های رزرو** (`RESERVED_SLUGS`): همهٔ مسیرهای Next موجود فروشگاه: `cart, checkout, search, account, wishlist, need, guides, track, about, contact, terms, privacy, returns, shipping, order, api, admin, pos, c, p` (و جمع‌بندی: هر مسیر سطح-یک موجود در `apps/storefront/app` را با glob بگیر و به لیست اضافه کن).
- **یکتاسازی:** تابع `ensureUniqueSlug(base, exists)` که در صورت تکرار پس‌وند `-2`, `-3`, … بدهد.

**اعمال slugify:** هر جا محصول/دسته/صفحهٔ CMS ساخته یا ویرایش می‌شود و اسلاگ خودکار ساخته می‌شود — در `apps/api/src/products/products.service.ts`، `apps/api/src/catalog/admin-catalog.controller.ts`، `apps/api/src/cms/cms.controller.ts` — اسلاگ را از `slugifyFa` + رزرو + یکتاسازی عبور بده. اسلاگ دستیِ واردشدهٔ مدیر فقط با نرمال‌سازی + چک رزرو/یکتایی ذخیره شود (خطای 409/422 واضح فارسی در صورت تکرار یا رزرو بودن).

**تست واحد:** برای `slugifyFa` (نرمال‌سازی، فاصله/نیم‌فاصله، یکتایی، رزرو) تست بنویس (کنار تست‌های موجود contracts یا storefront به سبک `apps/storefront/lib/*.test.ts`).

### A2. قفل دامنهٔ کانونیکال www + ریدایرکت ۳۰۱

- `apps/storefront/lib/site.ts`: `SITE_URL` → `"https://www.lebaszirghasedak.ir"`. (همین ثابت در `robots.ts`، `sitemap.ts` و `metadataBase` در `apps/storefront/app/layout.tsx` مصرف می‌شود — همه با یک تغییر درست می‌شوند؛ مطمئن شو جایی else دامنهٔ قدیمی هاردکد نشده باشد: جست‌وجوی `lebaszirghasedak.ir` در کل مخزن.)
- در `apps/storefront/middleware.ts`: اگر `Host` != `www.lebaszirghasedak.ir` و دامنهٔ درخواست apex یا www است (و در production)، `NextResponse.redirect("https://www.lebaszirghasedak.ir" + req.nextUrl.pathname + search, 308/301)` بده. در development (localhost) ریدایرکت نکن. برای تست‌پذیری، هاست کانونیکال را از env بگیر: `CANONICAL_HOST` (پیش‌فرض `www.lebaszirghasedak.ir`).
- در `docs/deploy-guide.md` همین قاعده را برای reverse-proxy سرور (nginx/caddy) هم مستند کن (قاعدهٔ ریدایرکت ۳۰۱ دائمی apex→www در سطح proxy، جدا از Next).
- **پایان‌اسلش:** یک سیاست واحد — توصیه: بدون پایان‌اسلش (وضعیت پیش‌فرض Next). در middleware ریدایرکت ۳۰۸ از `/path/` به `/path` برای مسیرهای غیرریشه اضافه کن. مطمئن شو canonicalها هیچ‌جا پایان‌اسلش ندارند.

### A3. متادیتا و دادهٔ ساخت‌یافته (JSON-LD)

- **صفحهٔ محصول** `apps/storefront/app/p/[slug]/page.tsx`: `generateMetadata` با title/description/canonical کامل؛ JSON-LD از نوع `Product` با نام/برند/تصویر/`offers` (قیمت ریالی با `IRR`، موجودی از واریانت‌ها) و اگر نظر تأییدشده دارد `aggregateRating`.
- **صفحهٔ دسته** `apps/storefront/app/c/[slug]/page.tsx`: JSON-LD `ItemList` + `BreadcrumbList`.
- **Layout ریشه** `apps/storefront/app/layout.tsx`: JSON-LD `Organization` (نام، لوگو، تلفن از `site`) + `WebSite` با `SearchAction` به `/search?q={search_term_string}`.
- در همهٔ صفحه‌های سطح‌یک (about/contact/terms/…) `alternates.canonical` درست ست شود.
- JSON-LD را در `script type="application/ld+json"` با dangerouslySetInnerHTML رندر کن (سبک Next معمول).

### A4. بازبینی robots و sitemap

- `apps/storefront/app/robots.ts`: مطمئن شو `disallow` کامل است: حداقل `/checkout`, `/cart`, `/order/`, `/account`, `/admin` (ادمین روی سابدامنه/پورت جداست ولی اگر همان origin سرو می‌شود بسته شود)، و `Allow: /api/` لازم نیست چون API روی origin دیگری است. sitemap با SITE_URL جدید خودکار درست می‌شود.
- `apps/storefront/app/sitemap.ts`: علاوه بر موارد موجود، **صفحات CMS داینامیک** (`/[slug]`) را از همان منبعی که storefront می‌خواند (`apps/storefront/lib/cms.ts`) اضافه کن؛ `lastModified` واقعی هر موجودیت اگر در دسترس است، وگرنه همان `now`.

### A5. جست‌وجوی فارسی

- در `apps/storefront/lib/catalog-repo.ts` تابع `searchV2` را ارتقا بده:
  - کوئری و متن کاندید هر دو از `normalizePersian` (شامل یکسان‌سازی نیم‌فاصله↔فاصله برای matching — یعنی مقایسه روی نسخهٔ «بدون نیم‌فاصله و با فاصلهٔ تکی» انجام شود).
  - جدول مترادف‌های دامنه در همان فایل یا contracts: مثلاً «سوتین↔قیف، شلوار↔شورت، بادی↔بادی‌سوت، ورزشی↔اسپرت، گن↔شکل، پیراهن خواب↔لباس خواب، نایتی↔لباس خواب، ست↔سوت و شورت». (مترادف‌ها را از نام/توضیح واقعی کاتالوگ seed استخراج کن تا بی‌ربط نشوند.)
  - نتایج مترادف فقط وقتی نتیجهٔ مستقیم کم است (مثلاً < آستانه یا وقتی کوئری مستقیم 0 داد) تا رتبه‌بندی بی‌خود نشود.
- تست واحد برای جست‌وجو: «سوتين» (با ي عربی) === «سوتین»؛ «نايتي» نتیجهٔ لباس‌خواب بدهد؛ نیم‌فاصله «بادی‌سوت» با ورودی «بادی سوت» پیدا شود.

### A6. سند ساختار URL

فایل `docs/url-structure.md` بساز: الگوی URL نهایی (دامنه www، مسیرها `/p/[slug]`، `/c/[slug]`، `/guides/[slug]`، `/[slug]` برای CMS، بدون پایان‌اسلش)، قواعد اسلاگ فارسی، لیست رزرو، سیاست ریدایرکت‌ها، canonical — این سند «قفل» است؛ بعد از آن هر تغییر URL باید مهاجرت ۳۰۱ داشته باشد.

### پذیرش بستهٔ A (همه باید برقرار باشند)

1. تست واحد slugify/رزرو/یکتایی سبز.
2. `curl -H "Host: lebaszirghasedak.ir" http://localhost:3000/p/x` در حالت production-build → ریدایرکت دائمی به `https://www...` (در dev با CANONICAL_HOST شبیه‌سازی/تست‌پذیر).
3. HTML صفحهٔ محصول شامل JSON-LD `Product` معتبر (اسم/قیمت/تصویر) و canonical با www باشد.
4. `/sitemap.xml` صفحات CMS + محصولات را با دامنهٔ www بدهد؛ `/robots.txt` درست.
5. جست‌وجوی فارسی: سه تست واحد A5 سبز.
6. `pnpm typecheck` سبز.

---

## بستهٔ B — گام ۲۲ (فقط بخش پیش از لانچ): مهاجرت argon2id + تکمیل CSRF (اندازه L)

**هدف:** هش رمز ادمین به argon2id ارتقا یابد (بدون شکستن ورود کاربران موجود) و سطح CSRF همهٔ فرم‌ها/اکشن‌های حساس تضمین شود.

**خارج از دامنه:** 2FA (بعد از لانچ)؛ تغییر جریان ورود/UX.

### B1. argon2id با rehash هنگام ورود

فایل اصلی: `apps/api/src/auth/auth.service.ts` (وضعیت فعلی: scryptSync با فرمت `scheme$salt$hash` ذخیره‌شده در `User.passwordHash`).

- **وابستگی از قبل هست** (`"argon2": "^0.45.1"` در `apps/api/package.json`، نصب‌شده در node_modules). مستقیم از همان استفاده کن و هیچ وابستگی جدیدی اضافه نکن. فقط مطمئن شو import آن در محیط CI سبز است (argon2 باینری prebuilt دارد؛ اگر CI شکست خورد عیب‌یابی کن، جایگزین نینداز). هش خروجی باید فرمت استاندارد PHC-string باشد.
- پارامترهای argon2id (OWASP 2024): memory ≥ 19 MiB (19456 KiB)، iterations=2، parallelism=1.
- فرمت ذخیرهٔ جدید: رشتهٔ استاندارد PHC، مثل `$argon2id$v=19$m=19456,t=2,p=1$<salt-b64>$<hash-b64>`؛ برای بازشناسی، یک تابع `hashInfo(stored)` بنویس که scheme را از ابتدای رشته تشخیص دهد (`scrypt$...` قدیمی یا `$argon2id$...`).
- **سازگاری:** `verify(password, stored)` هر دو فرمت را بپذیرد. مسیر `login` وقتی هش قدیمی بود و رمز درست بود، بلافاصله رمز را با argon2id **rehash** و در `user.passwordHash` ذخیره کند (کاربر متوجه چیزی نشود).
- **سازنده‌های هش رمز — فهرست کامل و بازبینی‌شده (فقط همین‌ها؛ هیچ چهارمی پیدا نشد):**
  1. `apps/api/src/auth/auth.service.ts` — مسیر اصلی ورود/هش (همین‌جا مهاجرت مرکزی انجام شود).
  2. `apps/api/src/auth/password-reset.service.ts` — تابع هش رمز جدید در reset (حدود خط ۳۶، `scrypt$...`).
  3. `apps/api/src/admin/admin-panel.controller.ts` — **سازندهٔ سومِ جدا و تکراری** (خطوط ~۱۶–۱۷، `crypto.scryptSync` محلی) که موقع ساخت کاربر ادمین هش می‌سازد — این تابع محلی را حذف و به همان مسیر مرکزی `AuthService` وصل کن تا فرمت‌های هش متفرقه باقی نماند.
  4. `packages/database/scripts/seed.ts` — کاربران seed.
  همه به argon2id یا همان تابع مرکزی `AuthService` مهاجرت کنند.
- **دقت:** `scryptSync` در `auth.service.ts` (خط ~۸۸، هش توکن session) و `createHash("sha256")` در `password-reset.service.ts` (هش توکن ریست) هشِ رمز نیستند — دست نزن.
- **مهاجرت دادهٔ یک‌باره لازم نیست:** تبدیل فقط با ورود کاربر انجام می‌شود (rehash-on-login)؛ به‌علاوه یک ادمین رمزش را با reset تغییر دهد هم rehash می‌شود. اگر مسیر reset password هش خودش می‌سازد، آن هم argon2id شود.
- کوکی‌های session و `hashToken` دست نخورد مگر لازم باشد.

### B2. تکمیل و راستی‌آزمایی CSRF

- **فروشگاه — وضعیت دقیق (بازبینی‌شده):** کوکی `csrf_token` + هدر `x-csrf-token` از `middleware.ts` ساخته می‌شود. امروز:
  - **چک دارند:** `app/api/checkout/route.ts`، `app/api/pay/start/route.ts`، `app/api/analytics/visit/route.ts`، `app/api/analytics/consent/route.ts`.
  - **چک ندارند و باید اضافه شود:** `app/api/cart/route.ts`، `app/api/cart/items/route.ts`، `app/api/cart/items/[variantId]/route.ts`، `app/api/reviews/route.ts` — مقایسهٔ cookie با header (نابرابر یا نبودن → 403).
  - **CSRF اعمال نمی‌شود:** `app/api/pay/callback/route.ts` (callback سرور-به-سرور درگاه، نه درخواست مرورگر)، `app/api/wishlist/route.ts` (فقط GET).
  - **سمت کلاینت:** امروز فقط `lib/analytics.ts`، `CheckoutClient.tsx` و `PayForm.tsx` هدر را می‌فرستند (هرکدام جداگانه کوکی را می‌خوانند). یک helper واحد بساز (مثلاً `apps/storefront/lib/csrf.ts` → `csrfHeaders()`)، در همهٔ فراخوانی‌های مینت استفاده کن (از جمله CartProvider/CartClient و ReviewForm که امروز اصلاً هدر نمی‌فرستند) و کدهای تکراری خواندن کوکی را به آن migrated کن.
- **ادمین/API (session cookie):** اکشن‌های مینتِ ادمین در `apps/api` با cookie session احراز می‌شوند (`apps/api/src/auth/session.middleware.ts`). چون SameSite=Lax است و ادمین/ادمین‌فرانتند همان مرجع‌اند، ریسک CSRF کلاسیک کم است؛ اما طبق برنامه، «فرم‌های حساس» را سخت‌گیرتر کن: برای اکشن‌های پولی/حسابداری (orders، payments، accounting، treasury، settings/credentials) یک گارد CSRF double-submit اضافه کن (ادمین در request هدر `x-csrf-token` را از کوکی بخواند و بفرستد — چون ادمین Next است، middleware ادمین هم می‌تواند کوکی را بگذارد مثل storefront؛ یا اگر کل ادمین API-only است، از هدر `Origin`/`Referer` هم‌origin بودن را در گارد چک کن). **ساده‌ترین مسیر سازگار با کد موجود را انتخاب کن** ولی در تست اثبات کن که درخواست بدون توکن از Origin دیگر رد نمی‌شود.
- همهٔ routeهای API که `API-Key` (هدر) احراز می‌کنند نیازی به CSRF ندارند (توکن خودش یک‌بار مصرف در هدر است).

### پذیرش بستهٔ B (همه باید برقرار باشند)

1. تست: ورود با `passwordHash` قدیمیِ scrypt → موفق؛ بعد از ورود، مقدار DB با `$argon2id$` شروع می‌شود.
2. تست: ورود با هش argon2id → موفق.
3. تست: رمز غلط → همان خطای `BAD_CREDENTIALS` فعلی.
4. تست: اکشن مینتِ حساس (مثلاً یک endpoint ادمین مالی) بدون هدر CSRF/با Origin غریب → 403؛ با هدر صحیح → موفق.
5. تست‌های موجود auth (`apps/api/test/phase14-password-reset.spec.ts` و دیگران) سبز بمانند (seed و هش‌های تست به argon2id یا مسیر قدیمیِ پشتیبانی‌شده migrate شوند).
6. اسکن مختصر امنیتی: کوکی‌ها `secure`/`sameSite` درست در production؛ هدرهای امن (در `main.ts`/deploy اگر helmet وجود دارد فقط گزارش کن — تغییر بزرگ نکن). دقت: فرمت هشِ قدیمی scrypt دقیقاً `scrypt$salt$hash` است (بدون `$` ابتدایی) — تابع تشخیص scheme (`hashInfo`) باید بر همین اساس باشد.
7. `pnpm typecheck` سبز.

---

## بستهٔ C — گام ۲۳: مانیتورینگ و هشدار (اندازه S)

**هدف:** وقتی چیزی خراب شد، صاحب فروشگاه بی‌درنگ با تلگرام/ایمیل مطلع شود — بدون افزودن SaaS جدید (تصمیم #۷).

**زیرساخت موجود که باید استفاده شود:** `apps/api/src/events/` (event-bus، notification-dispatcher با تنظیمات ایمیل/پیامک ادمین، sms-providers) و `apps/api/src/common/background-workers.ts` (گیت workerها). هیچ dependency جدیدی اضافه نکن مگر واقعاً لازم باشد؛ ابزار بیرونی uptime (مثل UptimeRobot/cron سرور) در مستندات توصیه می‌شود ولی در کد dependency نمی‌آید.

### C1. Health check و heartbeat

- **health از قبل وجود دارد و باید اصلاح شود، نه دوباره ساخته:** `apps/api/src/health/` روی `GET /api/v1/health` (prefix سراسری) سرو می‌کند. باگ فعلی: `HealthService` مقدار `redis` و `storage` را hardcode `false` برمی‌گرداند و چون status از AND هر سه است، **پاسخ همیشه `degraded` است** — یعنی هیچ ابزار uptimeی نمی‌تواند روی آن هشدار بگذارد. اصلاح:
  - چک‌های **الزامی** فقط `db` باشد (`SELECT 1`، که همین حالا هم هست)؛ `status = "ok"` وقتی db سبز است.
  - `redis`/`storage` به‌عنوان چک اطلاعاتی باقی بمانند (boolean جداگانه در `checks`، بی‌تاثیر بر status) — چون واقعاً redis/استوریج جدا در این پروژه فعال نیست وگرنه «degraded» همیشگی ادامه می‌یابد. این تغییر را در `HealthStatus` در `packages/contracts` (اگر فیلد status را مشروط می‌کند) هماهنگ کن.
  - نسخه (از `package.json` اپ) و uptime (موجود: `uptimeSeconds`) را نگه دار/اضافه کن؛ رسیدنی‌بودن رسانه‌ها را اگر با یک existence-check سبک (`mediaDir()` موجود در `apps/api/src/common/media-dir.ts`) ممکن است اضافه کن، وگرنه حذفش کن.
  - پاسخ باید < 1s باشد و تست HTTP آن وجود داشته باشد (به سبک `apps/api/test/phase15-boot-config.spec.ts`) — تست باید حالت db سبز → `ok` را هم اثبات کند.
- **Heartbeat workerها:** در event-bus/notification-dispatcher، هر تایمر پس از هر اجرا نتیجه را در یک log ساخت‌یافته با فیلدهای ثابت بنویسد (`component`, `status`, `durationMs`, `errorCount`). اگر worker در catch افتاد، به جای log خام رویداد مانیتورینگ بدهد (بخش C2).

### C2. سرویس هشدار و قواعد آن

- `apps/api/src/monitoring/alerting.service.ts`: صف‌بندی هشدارها + جلوگیری از طوفان هشدار (همان نوع هشدار حداکثر یک‌بار در پنجرهٔ زمانی، مثلاً ۳۰ دقیقه، مگر eskalate شود).
- **ارسال (بازبینی‌شده): در Settings ادمین هیچ تنظیم تلگرام وجود ندارد** و sms-providers گزارش credit هم نمی‌دهد. پس کانال هشدار این‌طور باشد:
  1. تلگرام با env: `ALERT_TELEGRAM_BOT_TOKEN` + `ALERT_TELEGRAM_CHAT_ID` — فراخوانی مستقیم Bot API با `fetch` (بدون وابستگی جدید).
  2. اگر تلگرام ست نبود، fallback به ایمیل از همان تنظیمات SMTP موجود notification-dispatcher.
  3. در development و تست، ارسال واقعی ممنوع: حالت dry-run (لاگ ساخت‌یافته) وقتی هیچ‌کدام ست نیست.
- UI جدیدی در Settings ادمین برای تلگرام نساز (اندازهٔ بسته S می‌مانَد)؛ فقط در `docs/deploy-guide.md` مستند کن چطور env ست شود.

**هشدارهای موردنیاز (همهٔ ۶ مورد برنامه):**
1. **قطع سایت/health:** یک تایمر دوره‌ای (مثلاً هر ۱ دقیقه، فقط در instance با workers روشن) که health خود را می‌سنجد؛ اگر ۲ بار پشت‌سرهم خراب بود → هشدار «سایت/health پایین است».
2. **۵xx بالای آستانه:** شمارندهٔ خطاهای ۵xx در `http-exception.filter.ts` با پنجرهٔ لغزان (مثلاً >10 در ۵ دقیقه) → هشدار.
3. **شکست بکاپ:** اگر سرویس بکاپ موجود (js در `infrastructure/`/`backup-status.controller.ts`) قابل‌هوک است، وضعیت failed را به alerting وصل کن؛ اگر بکاپ بیرونی است، در مستندات بنویس health آن چطور پایش شود.
4. **دیسک:** چک دوره‌ای فضای دیسک پارتیشن داده (آستانه 85%) → هشدار.
5. **اعتبار پیامک (معلق):** بازبینی شد — sms-providers فعلی هیچ API گزارش credit ندارد و در Settings هم چیزی برای آستانه ذخیره نمی‌شود. پس **این مورد را کد نکن**؛ فقط در `docs/deploy-guide.md` بنویس پنل ارائه‌دهنده (کاوه‌نگار و…) خودش هشدار اعتبار می‌دهد و بعداً اگر API credit اضافه شد چطور وصل می‌شود. ساخت کد ساختگی برایش ممنوع.
6. **عدم تطبیق تسویهٔ درگاه:** منطق مقایسه‌ای مستقل تسویه هنوز کامل نیست؛ پس فقط هوک نقطهٔ «پرداخت موفق ثبت‌شده در `payments.service.ts` ولی مبلغ/ارجاع با تراکنش درگاه هم‌خوان نیست» را بگذار (اگر validation موجود خطای مشخصی دارد، همان خطا رویداد هشدار بدهد)، و مبالغ unmatched در `treasury.service.ts` را در خروجی health/diagnostics فقط **گزارش** کن (نه هشدار خودکار). باقی را در مستندات «نیازمندان» ذکر کن.

هر موردی که زیرساختش نبود را **وصل نکن به کد ساختگی**؛ همان‌قدر که زیرساخت واقعی اجازه می‌دهد پیاده کن و باقی را صریح در مستندات «معلق/نیازمندان» بنویس.

### C3. مستندسازی راه‌اندازی

- بخشی در `docs/deploy-guide.md`: نحوهٔ ست‌کردن env هشدارها (`ALERT_TELEGRAM_BOT_TOKEN`، `ALERT_TELEGRAM_CHAT_ID`)، تنظیم ابزار uptime بیرونی به `GET /api/v1/health`، و لیست هشدارها با آستانه‌ها — به‌علاوهٔ صراحت دربارهٔ دو موردِ معلق (اعتبار پیامک، تطبیق کامل تسویه) و وضعیت هشدار بکاپ.

### پذیرش بستهٔ C (همه باید برقرار باشند)

1. `GET /api/v1/health` با DB سبز → `status: "ok"` (نه degraded) و در تست HTTP اثبات شود؛ با DB خراب (mock خطای DB) → `degraded`.
2. تست: health خراب شبیه‌سازی‌شده (مثلاً با mock خطای DB) → رویداد هشدار ساخته می‌شود و در حالت dry-run لاگ ساخت‌یافته ثبت شود — **بدون ارسال واقعی در تست**.
3. تست: آستانهٔ ۵xx فعال شود (چند خطای شبیه‌سازی‌شده در پنجره) → فقط یک هشدار (طوفان‌گریز).
4. تست heartbeat worker: worker روشن → لاگ ساخت‌یافته؛ worker خطا دهد → رویداد هشدار.
5. `pnpm typecheck` سبز.

---

## گزارش پایانی (خروجی تو)

وقتی هر سه بسته تمام شد، یک خلاصه بده شامل:
1. هر بسته: چه شد، کدام فایل‌ها تغییر کردند، کدام پذیرش‌ها اجرا/سبز شدند.
2. هر موردی که به دلایل فنی/زیرساختی **نشد** انجام شود و چرا (شفاف بنویس؛ گم نکن).
3. خروجی `pnpm typecheck` و تست‌های اجراشده (با شماره).
4. هر env جدید که اضافه شده (`CANONICAL_HOST`، `ALERT_TELEGRAM_BOT_TOKEN`، `ALERT_TELEGRAM_CHAT_ID`) — وابستگی جدیدی نباید اضافه شده باشد؛ اگر شده، چرا (argon2 از قبل نصب بود).
5. کارهای باقی‌مانده برای موج ۲ (گام ۲۱ و ۱۸-۳) که به این تغییرها وابسته‌اند (مثلاً چت‌بات باید از مترادف‌ها و اسلاگ‌های جدید استفاده کند).

