# معماری و طرح پیاده‌سازی فروشگاه «لباس زیر قاصدک»

> سند برنامه‌ریزی پیش از کدنویسی — نسخه ۱ (مهر ۱۴۰۵)
> تصویر مرجع: مودبورد claymorphism بنفش (تحلیل شده، نه کپی‌شده)

---

## ۱) تحلیل تصویر مرجع

### Visual Design
- پالت تک‌خانواده بنفش/یاسی با سطوح سفید «خمیری»؛ عکس‌های محصول color-graded در همان طیف صورتی-بنفش؛ آیکون‌های سه‌بعدی clay برای دسته‌ها؛ CTAهای گرادیان بنفش.
- **نقطه قوت:** انسجام رنگی بالا و حس نرم و زنانه.
- **ضعف:** متن‌های یاسی کم‌رنگ روی زمینه روشن کنتراست کافی ندارند؛ ریسک «همه‌چیز بنفش» و گم‌شدن CTA اصلی.

### Layout
- هدر شناور قرصی‌شکل با فاصله از لبه صفحه؛ Hero دوستونه (متن راست، تصویر کشو چپ)؛ ریل چیپ دسته‌ها؛ گرید ۶ ستونه محصول؛ دو بنر تبلیغاتی؛ ۴ کارت اعتماد؛ ریل برند؛ نوار خبرنامه؛ فوتر کارتی.
- **ضعف:** گرید ۶ ستونی کارت‌ها را به ~۱۵۰px خفه می‌کند و جای Badge/رنگ/سایز/Quick Add نمی‌دهد.

### Spacing
- ریتم عمودی خوب بین سکشن‌ها (~۵۶–۷۲px)؛ اما داخل کارت‌ها فشرده است و دکمه به متن چسبیده.

### Component Hierarchy
- الگوی تکرارشونده «عنوان سکشن راست + مشاهده‌همه چپ» خوب و قابل حفظ است.
- **ضعف:** در کارت محصول، قیمت و دکمه بنفش پررنگ با هم رقابت می‌کنند؛ ۶ دکمه یکسان پررنگ در یک ردیف سلسله‌مراتب را می‌شکند.

### Card Style
- سفید، گوشه ~۲۴px، سایه لطیف، متن وسط‌چین، Wishlist در گوشه. ساختار درست اما ساده‌تر از نیاز واقعی فروشگاه (بدون Badge، رنگ، سایز، تخفیف، Quick Add).

### Color Relationship
- همسایه (آنالوگ): بنفش ↔ صورتی، پالت روشن high-key.
- **هشدار کنتراست:** #A67DEA روی سفید ≈ ۳٫۲:۱ — برای متن زیر حد AA است؛ برای متن لینک/اکشن باید به تیره‌های خانواده (#6E46B8 به بعد) رفت و #A67DEA برای fill و آرت بماند.

### Shape Language
- تقریباً همه‌چیز قرصی (pill): دکمه، سرچ، چیپ، حتی فوتر. انسجام دارد، اما وقتی «همه‌چیز قرصی» باشد سلسله‌مراتب شکل گم می‌شود.

### Claymorphism
- سایه پخش لطیف + هایلایت داخلی لبه بالا = حس بادکردنی؛ در آیکون‌ها و سطوح بزرگ عالی است.
- **ریسک:** «سوپِ سایه»، هزینه رندر روی موبایل ضعیف، افت خوانایی اگر روی باکس‌های متنی هم اعمال شود.

### جمع‌بندی
- **نگه می‌داریم:** مفهوم Hero کشوی لباس زیر، چیپ دسته‌ها با آیکون clay، بنرهای نیازمحور، کارت‌های اعتماد، هدر شناور، مونوپالت بنفش، اعداد و قیمت فارسی.
- **تغییر می‌دهیم:** گرید ۴ ستونه با کارت بزرگ‌تر؛ حذف دکمه بنفش تمام‌عرض از همه کارت‌ها به‌جای Quick Add جمع‌وجور؛ افزودن Badge/رنگ/سایز به کارت؛ متن تیره #29232F؛ قرصی فقط برای دکمه/چیپ/اینپوت و کارت‌ها با شعاع ۲۰–۲۴؛ سایه فقط در ۳ سطح تعریف‌شده.

---

## ۲) Design System پیشنهادی

### رنگ (توکن)
| توکن | مقدار | مصرف |
|---|---|---|
| brand-50 | #F6F1FC | زمینه ریل/هیرو |
| brand-100 | #EEE6F8 | چیپ انتخاب‌شده، بج ثانویه |
| brand-200 | #E3DCE8 | border |
| brand-300 | #CBB4EE | hover ملایم، جداکننده پررنگ |
| brand-500 | #A67DEA | fill، آرت، گرادیان، فوکوس |
| brand-600 | #8F63D8 | hover دکمه اصلی |
| brand-700 | #6E46B8 | متن لینک/اکشن روی روشن (AA) |
| ink-900 | #29232F | متن اصلی |
| ink-700 | #4A4152 | متن ثانویه |
| ink-500 | #7A7183 | کپشن/placeholder |
| plum | #3B2948 | تیترها، بج تخفیف، Sticky Bar |
| surface | #FFFFFF | کارت/سطح |
| bg | #FBF8FE | پس‌زمینه صفحه |
| semantic | success #2E9E6B / error #C6455D / warning #C98A2D | فقط فرم و وضعیت — مصرف حداقلی |

قوانین: گرادیان فقط در CTA اصلی و Hero؛ بج تخفیف Plum (نه قرمز) برای حفظ پالت؛ متن روی دکمه اصلی سفید روی گرادیان #8F63D8→#6E46B8 (کنتراست ≥۴٫۵).

### تایپوگرافی — Vazirmatn Variable (OFL، self-host و subset)
- Display: ۲۸/۳۸ موبایل → ۴۰/۵۲ دسکتاپ، ExtraBold
- H2: ۲۲→۲۶ Bold | H3: ۱۸ | Body: ۱۴–۱۶ با line-height ۱٫۸ (نیاز فارسی) | Caption: ۱۲/۱٫۶
- قیمت: اعداد فارسی جدولی (tabular) با `Intl.NumberFormat('fa-IR')`، واحد «تومان» همیشه کوچک‌تر و کم‌رنگ‌تر.

### شعاع (Radius)
- مقیاس: ۱۰ / ۱۴ / ۱۸ / ۲۴ / ۳۲ / full
- قانون: قرصی فقط Button، Chip، Input، Sheet-handle؛ Card ۲۰–۲۴؛ Hero/Banner ۲۸–۳۲.

### Elevation (فقط ۳ سطح + هایلایت داخلی)
- `rest`: `0 1px 2px rgba(41,35,47,.05), 0 12px 28px -6px rgba(59,41,72,.12), inset 0 1.5px 0 rgba(255,255,255,.85)`
- `raised` (hover/درگ): blur و y بیشتر
- `pressed`: inset فرورفته
- قوانین: حداکثر ۲ لایه سایه بیرونی؛ سایه روی متن ممنوع؛ سایه‌ها با CSS variable و در `prefers-reduced-motion` ساده می‌شوند.

### Spacing
- گرید ۴px؛ فاصله سکشن ۴۰ موبایل / ۶۴ دسکتاپ؛ gutter ۱۶/۲۴؛ کانتینر ۱۲۰۰px؛ padding لبه صفحه موبایل ۱۶.

### آیکون و موشن
- دو ست: آیکون clay سفارشی (دسته‌ها/بنرها، SVG گرادیانی) + آیکون خطی ۱٫۵px (Lucide) برای اکشن‌ها.
- ترنزیشن ۱۵۰–۲۵۰ms ease-out، فقط transform/opacity، رعایت `prefers-reduced-motion`.

### بریک‌پوینت‌ها (Mobile-first)
- base ۳۶۰–۴۳۰ / sm ۶۴۰ / md ۷۶۸ / lg ۱۰۲۴ / xl ۱۲۸۰

---

## ۳) معماری فنی

**انتخاب: Next.js 15 (App Router) + TypeScript + Tailwind v4 + PostgreSQL + Drizzle ORM — فول‌استک در یک ریپو، ادمین سفارشی سبک، درگاه زرین‌پال، Object Storage سازگار S3 (MinIO/آروان)، جستجو با نرمال‌سازی فارسی + pg_trgm (مهاجرت بعدی به Meilisearch).**

دلایل (کوتاه):
1. RTL + Clay + UX خاص، کنترل کامل UI می‌خواهد → storefront اختصاصی بدون محدودیت قالب.
2. بازار ایران (زرین‌پال/پی‌پینگ، پست/تیپاکس، SMS) SaaS خارجی را عملی نمی‌کند → self-host اجتناب‌ناپذیر است.
3. Guest-first و کم‌اصطکاک: سبد سروری با کوکی امضاشده و پرداخت مهمان؛ این منطق را خودمان ساده‌تر می‌سازیم.
4. یک کدبیس/یک دیپلوی (Docker روی VPS ایرانی) = هزینه و پیچیدگی کم برای تیم کوچک.
5. Type-safety از DB تا UI (Drizzle + zod) و Server Actions برای فرم‌ها.

**گزینه جایگزین:** Medusa v2 به‌عنوان هسته Commerce (پنل/سفارش/تخفیف آماده) — انتخاب دوم؛ فعلاً به‌دلیل سربار دو اپ و شخصی‌سازی فارسی کنار گذاشته شد. WordPress/Woo مطابق خواسته پروژه منتفی.

---

## ۴) ساختار کامپوننت‌ها

### Primitives — `components/ui/`
Button (primary/secondary/ghost/icon + loading)، Chip (انتخابی)، Input/Select/NumberField، Badge (تخفیف/جدید/ناموجود)، Price، Rating (فقط امتیاز واقعی)، Skeleton، Modal/BottomSheet، Drawer، Toast، Accordion، Tabs، Pagination، EmptyState، ErrorState، Breadcrumb، QtyStepper.

### Commerce — `components/commerce/`
- **ProductCard:** تصویر، Wishlist، Badge، نام ≤۲ خط (line-clamp)، رنگ‌ها، سایزها، قیمت/تخفیف، Add to Cart، **Quick Add**
- QuickAddPopover (چیپ سایز درجا)، VariantSelector، ColorSwatches، SizeGuideModal (+ محاسبه کاپ)، StockStatus، PriceBlock
- CartLineItem، CartSummary، FilterGroup (چندانتخابی)، PriceRangeSlider، SortSelect، MobileFilterSheet
- **StickyBuyBar** (PDP موبایل)، Gallery، AddressForm، ShippingMethods، PaymentLauncher، OrderStatus

### Sections — `components/home/`
Header شناور (سرچ + سبد + منو)، **HeroDrawer تعاملی** (کشو با خانه‌های قابل‌کلیک → هر خانه یک دسته؛ SVG/3D clay، دسترس‌پذیر با کیبورد)، NeedNav (چیپ نیازها)، CategoryGrid، ProductShelf، PromoBanners، BrandRail، TrustBar، GuideTeasers، NewsletterBand، Footer.

---

## ۵) ساختار صفحات

| مسیر | نقش |
|---|---|
| `/` | خانه (HeroDrawer، NeedNav، دسته‌ها، پرفروش، جدید، برندها، اعتماد، راهنماها) |
| `/c/[slug]` | لیست محصول دسته + فیلترها در query string |
| `/search` | جستجو |
| `/p/[slug]` | صفحه محصول |
| `/cart` | سبد خرید |
| `/checkout` | گام‌ها: اطلاعات ← ارسال ← پرداخت (مهمان‌محور) |
| `/order/[code]` | رسید و پیگیری سفارش (کد + موبایل) |
| `/wishlist` | علاقه‌مندی‌ها |
| `/brands`, `/brands/[slug]` | برندها |
| `/guides`, `/guides/[slug]` | راهنمای سایز/شست‌وشو/اندازه‌گیری |
| `/about`, `/contact`, `/faq` | محتوایی |
| `/admin` | محصولات/تنوع/موجودی، سفارش‌ها، تخفیف‌ها، بنر/محتوا، تنظیمات ارسال |

نقشه UX ← نیازمندی: NeedNav (خریدار «نمی‌داند چه می‌خواهد»)، فیلترها + سرچ (خریدار «می‌داند»)، Size Guide در PDP، Quick Add در کارت، MobileFilterSheet، StickyBuyBar، Guest Checkout، شفافیت قیمت/ارسال/موجودی قبل از پرداخت، Skeleton/Empty/Error در همه لیست‌ها.

---

## ۶) مدل داده

- **Category**(id, slug, name, iconKey, sortOrder) — ۶ دسته اصلی
- **Brand**(id, slug, name, logo?)
- **Product**(id, slug, name, description, careInstructions, categoryId, brandId, material, images[], needTags[], isFeatured, createdAt)
- **Variant**(id, productId, sku, sizeLabel, band?, cup?, underwire: bool, sponge: none|thin|thick, colorId, priceToman: int, compareAtPriceToman?, stock: int, weightGrams, isActive)
- **Color**(id, name, hex) · **NeedTag**(slug, name, iconKey) — روزمره/زیر پیراهن/ورزش/شب/بارداری/سایز بزرگ
- **SizeChart**(categoryId, rows) + محتوای راهنما
- **Cart**(id, token کوکی امضاشده, items[variantId, qty], updatedAt, TTL)
- **Order**(code عمومی, items snapshot, address snapshot, shippingMethod, shippingCost, subtotal, discount, total, status: pending|paid|processing|shipped|delivered|canceled, gatewayRef, guestPhone)
- **ShippingMethod**(name, baseCost, perKgCost, freeThreshold?, zones)
- **DiscountCode**(code, type, value, limits)
- **Review**(productId, rating, body, isVerifiedPurchase, status: pending|approved) — فقط تأییدشده نمایش داده می‌شود
- **NewsletterSubscriber**، **ContactMessage**، **ContentPage**، **Banner**، **Setting**(key, value)
- **SearchIndex**: view نرمال‌شده (ی/ي، ک/ك، نیم‌فاصله، آ/ا) + pg_trgm

قواعد: قیمت عدد صحیح تومان (تبدیل به ریال فقط در درگاه)؛ کاهش موجودی در تراکنش با چک concurrent؛ تصویر فقط عکس محصول (بدون مدل) با alt فارسی اجباری؛ **هیچ داده جعلی realistic** — داده نمونه فقط با برچسب «نمونه» در dev و EmptyState در محیط واقعی.

---

## ۷) فازهای پیاده‌سازی

| فاز | محتوا | خروجی قابل‌لمس |
|---|---|---|
| ۰ | ریپو، Next+TS+Tailwind v4، RTL، فونت، توکن‌ها به‌صورت CSS vars، lint/typecheck/test، Docker dev | اسکلت اجراشدنی با هدر/فوتر پایه |
| ۱ | دیزاین‌سیستم: primitiveها + صفحه `/styleguide` + تست a11y پایه | کیت کامپوننت |
| ۲ | Schema/migration، آپلود عکس، ادمین MVP (محصول/تنوع/موجودی)، احراز هویت ادمین | ورود داده واقعی ممکن شود |
| ۳ | خانه: HeroDrawer تعاملی، NeedNav، دسته‌ها، شلف‌ها با EmptyState، برندها، Trust، خبرنامه | صفحه اول کامل |
| ۴ | PLP: فیلترهای چندانتخابی (سایز/کاپ/فنر/اسفنج/رنگ/جنس/برند/قیمت)، سورت، MobileFilterSheet، جستجوی نرمال فارسی | مسیر «می‌دانم چه می‌خواهم» |
| ۵ | PDP: گالری، تنوع، موجودی واقعی، SizeGuide، StickyBuyBar، QuickAdd، مرتبط‌ها | مسیر خرید کامل تا افزودن به سبد |
| ۶ | سبد + Checkout مهمان: کد تخفیف، ارسال و هزینه شفاف، زرین‌پال (سندباکس←اصلی)، رسید/پیگیری | قیف خرید کامل |
| ۷ | Wishlist، Review با تأیید ادمین، راهنماها/محتوا، FAQ | اعتماد و محتوا |
| ۸ | سخت‌سازی: a11y audit، Perf (LCP/CLS/عکس)، SEO (schema Product، sitemap)، E2E قیف خرید با Playwright | کیفیت تولیدی |
| ۹ | استقرار: Docker Compose روی VPS، بکاپ DB، Sentry، مانیتورینگ، ورود داده واقعی و آموزش ادمین | فروشگاه زنده |

Definition of Done هر فاز: typecheck + tests پاس، Lighthouse a11y ≥ ۹۰ موبایل، حالت‌های Loading/Empty/Error پوشش داده شده.
