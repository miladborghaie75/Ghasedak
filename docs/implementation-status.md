# وضعیت پیاده‌سازی — Ghasedak (بند ۲/۱۱۸ سند Master)

> آخرین به‌روزرسانی: ۲۰۲۶-۱۰-۱۵ — ایستگاه ۳/`F1-13` + گام ۱۰/`F1-14` + **گام ۱۱ (بند ۴۱ — نظرات و امتیاز) بسته شد**: چرخهٔ کامل OTP → توکن یک‌بارمصرف → ثبت PENDING → بج «خرید واقعی» از سفارش PAID → صف ادمین (تأیید/رد/پاسخ + AuditLog) → انتشار عمومی بدون PII؛ UI ادمین `/reviews` + بخش نظرات PDP فروشگاه (خلاصهٔ امتیاز + لیست + فرم OTP) + `aggregateRating` در JSON-LD. سوئیت محلی روی DB تازه‌کار (migrate+seed طبق رویهٔ CI): **۴۱/۴۱ سوئیت · ۲۳۵/۲۳۵ تست**؛ typecheck+build سه اپ سبز؛ ممیزی لحن دو اپ ۰ تخلف.
> تعریف «پیاده‌سازی‌شده»: مسیر runtime کامل کار کند (بند ۱۱۴/۱۱۸). Schema و سند به‌تنهایی «پیاده‌شده» نیست.

## استقرار پیش از لانچ — ایستگاه ۱ (۲۰۲۶-۱۰-۱۴) — runtime-tested
| قابلیت | وضعیت | مدرک |
|---|---|---|
| گارد متن خراب (`text-guard`): رد U+FFFD/کاراکتر کنترلی در نام/توضیح/SEO/اسلاگ محصول، دسته، برند، ویژگی | ✅ IMPLEMENTED | POST واقعی ادمین با نام `U+FFFD×4` → 400 `INVALID_TEXT` + `fieldErrors.name`؛ همان لحظه نام سالم فارسی → 201؛ تست `phase15-data-health` |
| جاب سلامت داده: اسکن متن/اسلاگ خراب + اکشن اصلاح idempotent با AuditLog per-row (`data.health.repair`) + worker هشداردهندهٔ روزانه | ✅ IMPLEMENTED | UI: ۶ یافته/۳ ردیف → ۲ ردیف اصلاح → ۱ یافتهٔ دستی؛ کاتالوگ عمومی ۱۳→۱۱ آیتم و ۰ نام خراب؛ `/p/-` و `/p/--muena3ig` → 404 |
| سیاست اصلاح صادقانه: نام غیرقابل‌بازیابی ← «نام اصلی از دست رفته — SKU: …» + اسلاگ `recovered-*` + ARCHIVED (بدون حذف سفارش/انبار) | ✅ IMPLEMENTED | `STAR-BRA-BLK-M` / `TEST-AUTO-1` با Audit قبل/بعد؛ اجرای دوباره `repaired=0` |
| حلقهٔ بی‌پایان سبد خرید (CartProvider) — ۲۳۰→۱ فراخوانی `/api/cart`، Checkout ۵۳.۸s→۲۵۴ms | ✅ IMPLEMENTED | شاهد قبل/بعد روی build تولیدی (گام ۱ و ۲ نقشه) |
| COGS عقب‌افتاده: `CogsBackfillService` + اکشن ادمین + worker (KPI گزارش سود = جدول = ۱۷۱٬۴۲۸) | ✅ IMPLEMENTED | JE-00459 روی ORD-000001؛ تست `phase14-cogs-backfill` |
| سوئیت کامل API روی DB تمرین | ✅ IMPLEMENTED | `npx jest --runInBand` → **۳۸/۳۸ سوئیت · ۲۱۲/۲۱۲ تست** (شامل phase15-data-health، phase15-callback-url، phase15-boot-config و پوشش fixture بکاپ) |

## ایستگاه ۲ (F2 — قفل دستاوردها) — ۲۰۲۶-۱۰-۱۴
| قابلیت | وضعیت | مدرک |
|---|---|---|
| CI پایه GitHub Actions: job کیفیت (install frozen → Prisma generate → typecheck → build سه اپ) + job تست API روی postgres:16 کاملاً تازه (migrate deploy → seed دمو → کل سوئیت) | ✅ IMPLEMENTED | ران سبز [38551035038](https://github.com/miladborghaie75/Ghasedak/actions/runs/38551035038) روی `b352fa5` — تست API ۷۰s · typecheck+build ۷۷s |
| گزارش تشخیصی شکست تست بدون لاگین (annotation عمومی `::error::` + Summary ران) | ✅ IMPLEMENTED | ران‌های قرمز ۱ و ۲: همین مسیر ریشه را نشان داد (ادعاهای ماشین عملیات بکاپ روی رانر Linux) |
| سوئیت تست portable — ادعاهای ماشین عملیات (بکاپ واقعی + Scheduled Task) با `OPS_MACHINE` گیت شده و پوشش fixture معادل دارد | ✅ IMPLEMENTED | `phase14-backup-status`/`phase14-diagnostics`؛ شبیه‌سازی CI: ۳ تست ops صریحاً skip + ۱۱ تست portable سبز |

## ایستگاه ۳ (F1-13 — طراحی بصری نهایی) — ۲۰۲۶-۱۰-۱۵ · 🟡 در جریان
| قابلیت | وضعیت | مدرک |
|---|---|---|
| سند مرجع طراحی: پالت خاک‌رس، سه سطح سایهٔ clay، توکن‌های معنایی + بازتعریف شب، وزیرمتن/لاله‌زار، قاعدهٔ «فقط توکن، بدون رنگ هاردکد تم-آگاه» | ✅ IMPLEMENTED | [design-system.md](design-system.md) — منطبق با `globals.css` فعلی (همان مقادیر) |
| حالت بارگذاری (اسکلتون) با زبان clay: نبض ملایم، گردی کارت، فقط توکن؛ `role=status` + `aria-label` | ✅ IMPLEMENTED | [Skeleton.tsx](../apps/storefront/components/ui/Skeleton.tsx)؛ `/wishlist` و `/cart` بدون پرش چیدمان روی build تولیدی |
| حالت خطای داده: «سبد/علاقه‌مندی الان قابل نمایش نیست — محفوظ است» + تلاش دوباره (نه ادعای خالی‌بودن، نه اسکلتون ابدی) | ✅ IMPLEMENTED | [DataUnavailable.tsx](../apps/storefront/components/ui/DataUnavailable.tsx)؛ تست زنده: دِو با `API_ORIGIN` مرده (پروکسی `{"items":[]}`) → هر دو صفحه پیام صادقانه را نشان دادند |
| رفع رگرسیون fallback سبد: خطوط سبد در قطع API از localStorage برمی‌گردند (تعهد سرصفحهٔ CartProvider که اجرا نمی‌شد) | ✅ IMPLEMENTED | [CartProvider.tsx](../apps/storefront/components/providers/CartProvider.tsx)؛ با API مرده سبد برمی‌گردد؛ روی سرور سالم سبد واقعی بی‌تغییر درست رندر می‌شود |
| OG/سوشال-کارت ۱۲۰۰×۶۳۰ با هویت برند (نشان قاصدک، لاله‌زار/وزیرمتن، پیل دامنه) — بدون فونت شبکه‌ای | ✅ IMPLEMENTED | `GET /opengraph-image` → `200 image/png`، `PNG 1200x630`؛ در build استاتیک prerender شد (`○ /opengraph-image`)؛ TTFهای استاتیک در `apps/storefront/app/og-fonts` (قید: satori فقط sfnt/TTF می‌فهمد، woff2 رد می‌شود) |
| آیکون اپ ادمین (همان نشان روی زمینهٔ آلو) — تمایز ابزار داخلی با هویت مشترک | ✅ IMPLEMENTED | [apps/admin/app/icon.svg](../apps/admin/app/icon.svg)؛ فروشگاه از قبل آیکون داشت |
| بازبینی دو تم با اسکرین‌شات + چک RTL/LTR مختلط | ✅ IMPLEMENTED | `/`، `/p/tst-Lmv7z66pr`، `/wishlist`، `/cart` در روشن/شب؛ نام لاتین محصول + اعداد فارسی + breadcrumb + هندل اینستاگرام بدون شکست bidi؛ صفر خطای کنسول |
| شات‌لیست عکاسی واقعی (کادرها، نسبت، نور، نام فایل تحویل) | ✅ IMPLEMENTED | [photography-shotlist.md](photography-shotlist.md) |
| عکاسی واقعی + حذف تصویرسازی جانشین از صفحات لانچ | ⬜ NOT YET | وابسته به تحویل عکس؛ تا آن زمان جانشین **عمداً** می‌ماند (رکورد در نقشه) |
| سبک چاپ: کاغذ سفید/مرکب سیاه، بی‌سایه/بی‌انیمیشن، کارت با حاشیهٔ نازک + `break-inside: avoid`، `@page A4`؛ کروم سایت و کنترل‌های تعاملی با `print:hidden` | ✅ IMPLEMENTED | [globals.css](../apps/storefront/app/globals.css)؛ در `media=print` سنجیده شد: هدر/فوتر/لینک پرش/نوار چسبنده/قلب/افزودن‌به‌سبد همه `display:none` (۰ استثنا)، بدنه سفید و متن سیاه |
| فاکتور قابل چاپ سفارش: جدول اقلام (نام/SKU/تعداد/قیمت/جمع) + جمع‌ها + کد/تاریخ شمسی/وضعیت — از مسیر عمومی **بدون PII** | ✅ IMPLEMENTED | [order/[code]/page.tsx](../apps/storefront/app/order/[code]/page.tsx)؛ PDF واقعی Chrome: **فاکتور ۱ صفحهٔ A4**؛ جمع‌ها با API می‌خوانند (۷۴۹٬۰۰۰ + ۴۹٬۰۰۰ = ۷۹۸٬۰۰۰) |
| برگهٔ مشخصات محصول: گالری جمع‌شده، هویت فروشگاه فقط-چاپ، بدون CTA/کنترل تعاملی | ✅ IMPLEMENTED | [p/[slug]/page.tsx](../apps/storefront/app/p/[slug]/page.tsx)؛ PDF واقعی: **۱ صفحه** (قبل از رفع باگ: ۳ صفحه با صفحهٔ اول خالی) |
| سه باگ که تست واقعی چاپ پیدا کرد: نامرئی‌شدن متن تم شب روی کاغذ (توکن + تزریق `<style>` تم در `<body>`) · سفیدچاپ‌شدن بلوک‌های موشن‌ریویل · سه‌صفحه‌ای‌شدن PDP با پدینگ نوار چسبنده | ✅ IMPLEMENTED | سنجش رنگ در هر دو تم (متن سیاه در `light` و `dark`)، `[data-motion=reveal] → opacity:1` در چاپ، `print:pb-0` (۳ → ۱ صفحه) |
| ممیزی کپی‌رایتینگ همهٔ CTA/حالت‌های خالی و خطا | ✅ IMPLEMENTED | پکیج مشترک [copy-rules](../packages/copy-rules) (قواعد R1–R7) + صفحهٔ ادمین «تنظیمات → ممیزی لحن» با اسکن دو اپ و انتشار اصلاح؛ اسکن کامل → ۰ تخلف؛ حلقهٔ سرتاسری تزریق→شناسایی→اصلاح→پاک؛ گیت سبز: تست گارد لحن + typecheck + build ادمین + API ۳۸/۳۸ · ۲۱۲/۲۱۲ |
| بازبینی نهایی موشن (گام ۹) | ✅ IMPLEMENTED | [MotionReveal.tsx](../apps/storefront/components/MotionReveal.tsx) + [globals.css](../apps/storefront/app/globals.css): reveal با IntersectionObserver + fallback تایمری + پوشش بلوک‌های رندر-شدهٔ بعد از ناوبری (باگ «صفحهٔ خالی تا رفرش» رفع شد) + احترام reduced-motion در JS و CSS. شاهد زنده روی سرور تولیدی 3111: بلوک‌های زیر فولد فوراً `motion-in`، بلوک‌های پایین با اسکرول `opacity=1` شدند؛ شدت/خاموش از تنظیمات ادمین (`Setting: motion`) |

## ایستگاه ۳/گام ۱۰ (F1-14 — صفحات سیستمی + حالت تعمیر) — ۲۰۲۶-۱۰-۱۵ — runtime-tested
| قابلیت | وضعیت | مدرک |
|---|---|---|
| صفحات سیستمی هر دو اپ: `error.tsx` + `global-error.tsx` + `loading.tsx` + `not-found.tsx` ادمین | ✅ IMPLEMENTED | هر دو اپ build تولیدی سبز؛ ۴۰۴ فارسی فروشگاه روی سرور زنده رندر شد (شاهد HTTP) |
| حالت تعمیر فروشگاه: endpoint عمومی `GET /api/v1/admin/public/maintenance` + TTL ۱۵s + fail-open در قطع API | ✅ IMPLEMENTED | [maintenance.ts](../apps/storefront/lib/maintenance.ts)؛ layout ریشه کل فروشگاه را می‌بندد و [MaintenanceNotice](../apps/storefront/components/MaintenanceNotice.tsx) می‌گذارد |
| حالت تعمیر — سوئیچ ادمین + رد سفارش | ✅ IMPLEMENTED | تنظیمات ادمین → کلید «حالت تعمیر» (POST /admin/settings)؛ checkout با کد `MAINTENANCE` رد می‌شود؛ تست `phase16-maintenance` |
| e2e کامل حالت تعمیر روی سرورهای زنده | ✅ IMPLEMENTED | روشن از DB: `/`، `/c/…`، `/cart`، `/about` همه صفحهٔ اطلاع + `data-motion-enabled="off"`؛ POST checkout → `MAINTENANCE`؛ خاموش → فروشگاه طی TTL ۱۵s به حالت عادی برگشت |

## ایستگاه ۳/گام ۱۱ (بند ۴۱ — نظرات و امتیاز) — ۲۰۲۶-۱۰-۱۵ — runtime-tested
| قابلیت | وضعیت | مدرک |
|---|---|---|
| مدل داده: `Review` (productId×mobile یکتا، rating ۱–۵، status PENDING/APPROVED/REJECTED، isVerifiedPurchase، adminReply) + `OtpCode` با purpose=`review` | ✅ IMPLEMENTED | migration `20261015100000_step11_reviews_otp` اعمال شد؛ شِما generate پاس |
| چرخهٔ OTP: کد واقعی DB (بدون وابستگی به اپراتور SMS — بند ۱۱۱)، کد غلط رد، کد درست توکن یک‌بارمصرف می‌دهد | ✅ IMPLEMENTED | تست `reviews.spec` — «چرخهٔ OTP» + «توکن یک‌بارمصرف» |
| ثبت نظر: فقط با توکن سالم؛ PENDING پیش از تأیید؛ ضدتکرار موبایل×محصول با خطای صریح | ✅ IMPLEMENTED | تست «ثبت نظر → PENDING» + «ضدتکرار» |
| بج «خرید واقعی»: سفارش PAID با همان موبایل و همان محصول → تأیید خودکار؛ بدون خرید بج نمی‌گیرد (ادعای جعلی ممنوع) | ✅ IMPLEMENTED | تست «بج خریدار واقعی» (هر دو حالت) |
| اداری ادمین: صف با شمارنده‌های وضعیت + موبایل برای تماس، تأیید/رد/پاسخ + AuditLog کامل (actorId واقعی، old/new values) | ✅ IMPLEMENTED | تست «تأیید ادمین → AuditLog» + «پاسخ/رد» + «صف ادمین»؛ FK `AuditLog.actorId → User` با کاربر واقعی رعایت شد |
| نمایش عمومی: فقط APPROVED، بدون هیچ PII (موبایل در پاسخ نیست)، خلاصهٔ count/avg/tags | ✅ IMPLEMENTED | تست JSON عمومی شامل هیچ موبایلی نیست؛ `found=false` برای محصول ناموجود |
| پنل ادمین `/reviews`: فیلتر وضعیت، تأیید/رد/پاسخ درجا، لحن «تو» مطابق R1 | ✅ IMPLEMENTED | copy.test ادمین سبز؛ لحن R1 اول «پاسخ شما» گرفت و به «پاسخ تو» اصلاح شد |
| UI فروشگاه در PDP: خلاصهٔ امتیاز + لیست + فرم ثبت (موبایل→OTP→متن)، پراکسی سرور `/api/reviews` | ✅ IMPLEMENTED | build فروشگاه سبز؛ پراکسی همان الگوی `/api/checkout` |
| SEO: `aggregateRating` در JSON-LD محصول (فقط با نظر منتشرشده — بدون داده جعلی) | ✅ IMPLEMENTED | [p/[slug]/page.tsx](../apps/storefront/app/p/[slug]/page.tsx) |
| تست چرخهٔ کامل (۱۲ تست) روی DB ایزوله `ghasedak_reviews_test` (migrate+seed طبق CI) | ✅ IMPLEMENTED | سوئیت کامل ۴۱/۴۱ · ۲۳۵/۲۳۵ سبز؛ نکتهٔ فنی: تست از کاربر واقعی برای AuditLog.actorId استفاده می‌کند (FK به User) |

## فاز ۱۳ (۲۰۲۶-۰۹-۳۰) — runtime-tested
| قابلیت | وضعیت | مدرک |
|---|---|---|
| رسانه: جزئیات/ویرایش/جایگزینی/حذف تأییدی + رفع BigInt + سقف بدنهٔ 15mb | ✅ IMPLEMENTED | آپلود test.jpg روی prod: serve byte-identical؛ آزمون‌های ۱۳تایی |
| گاوصندوق credential (apps/api/.env.local — خارج از git، ماسک‌شده) | ✅ IMPLEMENTED | ذخیره/ماسک/لودر بوت/پاک‌سازی تست شد |
| چند-اپراتور پیامک: کاوه‌نگار/قاصدک/ملی‌پیامک/مدیانا/آی‌تی‌پنل/ایده‌پردازان | ✅ IMPLEMENTED | انتخاب فعال با audit، تست اتصال، NOT_CONFIGURED صادقانه؛ ارسال واقعی پس از خرید کلید |
| گیت انتشار خودکار (gate-b1.mjs: pre/post) | ✅ IMPLEMENTED | GREEN روی rehearsal + تست منفی RED |
| پاک‌سازی فایل‌های بی‌صاحب (media-orphans.mjs) | ✅ IMPLEMENTED | ۱ فایل یتیم حذف؛ prod تمیز |
| اسکریپت run-local: احترام DATABASE_URL بیرونی + workers=off پیش‌فرض dev | ✅ IMPLEMENTED | ۳×restart سبز |
| شکست‌های باقی‌مانده (بند ۱۱۸) | ❌ NOT IMPLEMENTED | COGS سند فروش، سند خرید/AP، بازیابی رمز، 2FA، پشتیبان زمان‌بندی‌شده، سازندهٔ صفحهٔ کامل، سئوی کامل، جست‌وجوی فارسی پیشرفته، صف کار واقعی، وب‌هوک خروجی، AI، کانال‌های انتشار |

## ۱) موجود و سالم (Existing and working)
- مونوریپو pnpm/Turborepo: `apps/storefront` (۵۲ فایل، ۳۲ مسیر، RTL/Palette/بدون مدل زن/بدون داده جعلی — build + QA قبلی کامل)
- `apps/api`: NestJS skeleton + requestId + ErrorFilter بند ۶۵ + Health
- `packages/contracts`: Money صحیح IRT (roundDiv) + ApiError + Pagination + Health DTO
- `packages/utils`: cn/format واحد؛ storefront با shim مصرف می‌کند
- `packages/database`: شِمای Prisma ~۲۳۲۰ خط، معتبر، generate پاس (پوشش کامل Commerce Suite + Payment بازنگری‌شده + TrustBadge)
- docker-compose (postgres+redis) + .env.example آماده — ولی Docker روی سیستم نیست

## ۲) موجود اما ناقص (Existing but incomplete)
- `apps/api`: فقط Health — هیچ ماژول دامنه‌ای، هیچ Auth، هیچ اتصال DB
- Health: db/redis/storage همیشه false گزارش می‌دهند

## ۳) فقط شِما (Schema-only)
- کل Commerce Suite (Ledger/WAC/Journal/POS/Purchase/Tax/Check/…): مدل‌ها آماده، سرویس صفر

## ۴) فقط سند (Documentation-only)
- docs/ معماری (۶ سند) + نقشه راه فازها

## ۵) مفقود (Missing)
- PostgreSQL زنده (Docker و PG روی سیستم نصب نیستند)
- apps/admin (کلاً وجود ندارد)
- Auth/RBAC runtime، همه ماژول‌های API، تست‌ها

## ۶) متناقض (Conflicting)
- `InventoryMovement` legacy در شِما هم‌نام با Ledger جدید — برچسب‌گذاری شد؛ حذف پس از migration داده (تصمیم: در V1 migration تازه، مدل legacy حذف و فیلدهای projection stockQty کافی است)
- شِما storefront قبلاً دیتای دمو محلی داشت (lib/catalog) — ماندگار تا اتصال API؛ بعد از اتصال حذف کامل (قاعده ۹۵: بدون fallback پنهان به فیک)

## ۷) در همین تسک پیاده شد (Implemented during this task — runtime-تست‌شده)

| فاز | خروجی | وضعیت runtime |
|---|---|---|
| B | PostgreSQL 16.4 باینری Zonky روی `localhost:5433` + db `ghasedak` + `infrastructure/pg-setup.ps1` | ✅ IMPLEMENTED — سرور LISTEN، CREATE DATABASE موفق |
| C | Migration `init` کامل شِما (~۸۰ مدل) اعمال شد | ✅ IMPLEMENTED — `prisma migrate dev` پاس |
| D | Seed DEMO: ۴ کاربر با نقش/permission، انبار MAIN، ۵ سطح قیمت، ۵ کانال، ۵ روش پرداخت (اقساطی disabled)، TaxRate صفر، ۶ دسته، اتریبیوت‌ها، محصول+۲ واریانت+بارکد، COA ۸ حسابه | ✅ IMPLEMENTED — idempotent، همه برچسب DEMO |
| E | PrismaModule + BigInt→string serializer در پاسخ | ✅ IMPLEMENTED |
| F | Auth (login/logout/me با session httpOnly + scrypt) + PermissionsGuard سراسری + Products CRUD (list/create/update/soft-delete) + Accounting (post/trial-balance/integrity) | ✅ IMPLEMENTED — smoke پاس: ورود، سند متوازن ثبت، نامتوازن رد (`JOURNAL_UNBALANCED`)، صندوقدار → حسابداری `FORBIDDEN` |
| G | `apps/admin` روی :3200 — ورود Server Action، داشبورد empty-state واقعی، منو permission-aware، جدول محصولات از API، صفحه حسابداری (توازن + تراز آزمایشی) | ✅ IMPLEMENTED — build + E2E در مرورگر پاس |
| تست | ۹/۹ پاس: ۶ تست Journal با DB واقعی (متوازن/نامتوازن/ردیف صفر/integrity/تراز) + ۳ تست RBAC (401/403/عبور) | ✅ IMPLEMENTED |

## ۸) تست‌شده (Tested)
- `npx jest --runInBand` در `apps/api` → 9/9 ✓ (Journal integration با DB واقعی + RBAC unit)
- Smoke E2E: login admin → products (از DB) → post journal → unbalanced رد → cashier FORBIDDEN → trial balance متوازن (۵٬۲۴۳٬۰۰۰ = ۵٬۲۴۳٬۰۰۰)
- ادمین در مرورگر: ورود واقعی → داشبورد/محصولات/حسابداری همه از API زنده
- هر ۳ اپ هم‌زمان بالا: :3111 / :3200 / :4000 همه 200
- Migration دوم `infrastructure_enablers` (FeatureFlag/ConsentRecord/DomainEventOutbox/StockAlert) اعمال + seed فلگ‌ها (همه خاموش)
- سند نهایی معماری: `docs/master-architecture-checklist.md` — ماتریس ۳۰ حوزه شما × DB/Event/Permission/فاز؛ از این پس قابلیت جدید فقط با پرکردن ۵ ستون همان جدول

## ۹) فاز دوم — زنجیره دامنه کامل (runtime-tested)

| ماژول | وضعیت | مدرک runtime |
|---|---|---|
| InventoryService (Ledger، رزرو TTL، مصرف، idempotent) | ✅ IMPLEMENTED | `SALE DEMO-BRA-75B-BLK out=1 bal=9 key=sale:…` + رزرو CONSUMED |
| Orders/Checkout مهمان (قیمت سرور-محور، کد تخفیف، snapshot، رزرو اتمیک) | ✅ IMPLEMENTED | `ORD-000001 total=798000`؛ تکرار با همان idem = همان سفارش |
| Payments (state machine، idempotency، verify سمت‌سرور، ZarinPal+Mock adapter) | ✅ IMPLEMENTED | callback→verify→`PAID refId=MOCKRF-…`؛ verify دوم idempotent |
| POS (فاکتور FINALIZED با شیفت، قیمت سطح POS، پرداخت چندگانه) | ✅ IMPLEMENTED | `POS-000001 grandTotal=749000`؛ شیفت با `difference:0` بسته شد |
| RMA/Returns (REQUESTED→APPROVED→RECEIVED→SETTLED، hygiene policy) | ✅ IMPLEMENTED (سرویس+API) | build پاس؛ E2E دستی pending |
| Shipping (Shipment مستقل، LABEL/IN_TRANSIT/DELIVERED، رهگیری عمومی) | ✅ IMPLEMENTED (سرویس+API) | build پاس؛ E2E دستی pending |
| Event Bus (Outbox pattern، retry/backoff، unique idempotent) | ✅ IMPLEMENTED | worker هر ۵ ثانیه؛ OrderPaid پروسس می‌شود |
| Storefront چک‌اوت واقعی (proxy `/api/checkout`، صفحه پرداخت، mock gateway، paid/failed) | ✅ IMPLEMENTED | `next build` پاس؛ redirect به `/checkout/pay/mock?…` |
| Admin جدید: سفارش‌ها/پرداخت‌ها/فاکتورهای POS از API زنده | ✅ IMPLEMENTED | build + جدول از DB واقعی |
| Security: helmet headers + rate-limit (login 10/min، checkout 20/min) | ✅ IMPLEMENTED | `401×10 سپس 429`؛ `X-Content-Type-Options` فعال |
| Health db واقعی (`SELECT 1`) | ✅ IMPLEMENTED | `"db":true` |

## ۱۰) پیاده‌نشده و چرا (Not implemented and why)

| ماژول | وضعیت دقیق (بند ۱۱۸) | دلیل |
|---|---|---|
| WAC/COGS خودکار از فروش (فاز O) | SCHEMA + Ledger آماده | حرکت SALE ثبت می‌شود؛ میانگین موزون و سند COGS فاز بعد |
| Purchasing runtime (فاز N) | SCHEMA ONLY | Supplier/PO/GRN مدل کامل؛ سرویس فاز بعد |
| Reports (فاز V) | PARTIAL — trial balance و integrity زنده | بقیه گزارش‌ها فاز V |
| scrypt→argon2id، 2FA، CSRF کامل | DEFERRED | فاز AC؛ session فعلی httpOnly+SameSite |
| Redis/Storage در Health | NOT CONFIGURED | سرویس خارجی؛ degraded صادقانه |
| ZarinPal/Kavenegar/Google واقعی | REQUIRES EXTERNAL CREDENTIAL (بند ۱۱۱) | Adapter کامل، بدون credential فعال نمی‌شود؛ ساختگی ممنوع |
| کارت‌به‌کارت UI ادمین (تایید/رد/اصلاح) | SCHEMA + مدل آماده | workflow سرویس در فاز بعد |

## ۱۱) باگ‌های واقعی گرفته‌شده در این تسک
1. `BigInt` → `JSON.stringify` کرش می‌کرد → serializer پاسخ
2. `fetch` با URL نسبی در Server Action/سرور Next کرش می‌کرد → `API_ORIGIN` مطلق
3. `RequirePermission` با `Reflect.defineMetadata` دستی شکننده بود → `SetMetadata` استاندارد Nest
4. `NumberSeries.nextNumber` تایپ Int بود نه BigInt → drift تراکنش اتمیک شماره‌گذاری
5. تست RBAC با descriptor واقعی Nest — بازنویسی مطابق ساختار SetMetadata
6. `PosInvoice` ستون `shiftId` نداشت → migration `pos_shift_link` + رابطه دوطرفه
7. مدل واقعی `CashierShift`/`PosPayment` با فرض اولیه فرق داشت → سرویس بازنویسی روی شِمای واقعی
8. Idempotency پرداخت: verify تکراری دوباره سند/مصرف نمی‌زند (تست: verify دوباره = همان PAID)
