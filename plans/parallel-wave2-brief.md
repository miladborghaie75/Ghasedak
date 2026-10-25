# بریف موج ۲ — موازی (گام ۱۸-۳ چت‌بات، گام ۲۱ کارایی)

> این بریف **فقط** کارهای پیش‌لوانش باقی‌مانده را پوشش می‌دهد که در موج ۱ نبوده‌اند.
> اصل: هر کاری که زیرساخت واقعی‌اش الان وجود ندارد، «کد ساختگی» ننویس — همان‌قدر پیاده کن و بقیه را در مستندات «معلق/نیازمندان» ثبت کن.

---

## ۰) قواعد اجرا (همان موج ۱)

| قانون | توضیح |
|---|---|
| **بدون فیک** | اگر API/Provider در دسترس نیست، اندپوینت `NOT_CONFIGURED`/`REQUIRES_CREDENTIAL` بدهد، نه stub. |
| **پذیرش صریح** | هر تسک با معیار پذیرش قابل‌تست (HTTP/unit/e2e) + شاهد (لاگ/اسکرین‌شات/خروجی JSON). |
| **Typecheck سبز** | `pnpm typecheck` در انتهای هر تسک. |
| **تغییرات اتمیک** | هر تسک در یک کامیت/برنچ کوچک؛ مرج بعد از سبز شدن تست‌های مربوطه. |
| **مستندسازی معلق** | هر موردی که به دلایل زیرساختی کامل نشد، در `docs/deploy-guide.md` بخش «معلق/نیازمندان» با دلیل صریح ثبت شود. |

---

## ۱) اولویت‌بندی و وابستگی‌ها

```
┌─────────────────────────────────────────────────────────────┐
│  گام ۱۸-۳ — چت‌بات مشتری (F2-3) — اولویت ۱                  │
│  ├─ وابستگی: کارت تنظیمات AI (گام ۱۸-۲، تصمیم #۱۵) ✅ آماده |
│  ├─ وابستگی: مترادف‌ها/اسلاگ‌های فارسی (گام ۲۰) — در حال اجرا |
│  └─ خروجی: ویجت چت در فروشگاه + اندپوینت `/api/ai/chat`    │
├─────────────────────────────────────────────────────────────┤
│  گام ۲۱ — کارایی (F1-8) — اولویت ۲                          │
│  ├─ وابستگی: تصاویر/فونت/ایندکس‌ها (بخش ۳ برنامهٔ کامل)  │
│  ├─ بستهٔ independente (می‌تواند هم‌زمان با چت‌بات اجرا شود) │
│  └─ خروجی: جدول قبل/بعد Lighthouse + p95 API + ≥۳ بهبود   │
└─────────────────────────────────────────────────────────────┘
```

> **نکته:** گام ۲۱ (کارایی) وابستگی سخت به گام ۱۸-۳ ندارد؛ دو تسک می‌توانند **هم‌زمان** توسط دو نفر/شاخه اجرا شوند. اگر تیم تک‌نفره است، اول چت‌بات (چون مستقیماً روی تبدیل تأثیر دارد)، بعد کارایی.

---

## ۲) تسک ۱: گام ۱۸-۳ — چت‌بات مشتری (F2-3) 🤖

### ۲-۱. اهداف و دامنه
- **راهنمای خرید گفتگویی** روی دادهٔ ویزارد نیاز‌یاب + FAQ.
- **Fallback** به ویزارد نیاز‌یاب (گام ۱۶) وقتی مطمئن نیست.
- **محدودیت هزینه/نرخ**: max tokens/request، rate-limit IP، budget روزانه.
- استفاده از **همان کارت تنظیمات AI** (گام ۱۸-۲، تصمیم #۱۵): `AI_BASE_URL` + `AI_API_KEY` + `AI_MODEL`.

### ۲-۲. Архитекچر پیشنهادی (حداقل‌لازم)

```
storefront/
├─ app/api/ai/chat/route.ts        # POST { messages, context? } → SSE/JSON
├─ components/commerce/ChatWidget.tsx
├─ lib/ai-client.ts                # کلاینت سازگار OpenAI (base_url از env)
└─ lib/chat-system-prompt.ts       # پرامپت سیستمی با contexto فروشگاه
```

**API Contract:**
```typescript
// POST /api/ai/chat
// Body: { messages: {role: "user"|"assistant", content: string}[], context?: { page?: string, productSlug?: string } }
// Response: SSE (text/event-stream) یا JSON { reply: string, suggestions?: string[], handoff?: "wizard"|"human" }
```

### ۲-۳. پرامپت سیستمی (محتوا)
- شناخت کاتالوگ: برندها، دسته‌ها، ویژگی‌های کلیدی (سایز، جنس، رنگ).
- قوانین: **فقط** بر اساس داده‌های ویزارد/FAQ پاسخ دهد؛ حدس نزند.
- وقتی پاسخ ندارد → `handoff: "wizard"` + پیشنهاد شروع نیاز‌یاب.
- زبان: فارسی، لحن دوستانه-رسمی (راهنمای کپی `docs/copy-tone-guide.md`).

### ۲-۴. محدودیت‌های هزینه/ایمنی
| محدودیت | مقدار پیش‌فرض | کنترل |
|---|---|---|
| Max tokens/request | 500 | `AI_MAX_TOKENS` env |
| Rate-limit IP | 10 req/min | در `rate-limit.middleware.ts` |
| Budget روزانه (اختیاری) | ۱۰۰k tokens | لاگ در `ai-client.ts`، هشدار در health اگر گذشت |

### ۲-۵. UI/UX (فروشگاه)
- **مکان**: گوشه پایین‌چپ، دکمه بازکردن با آیکون چت، `z-index: 50`.
- **حالت‌ها**: باز/بسته، minimizable، accessible (ARIA، فوکوس، Esc برای بستن).
- **تم**: هم‌رنگ با طراحی سیستم (CSS variables)، احترام `prefers-reduced-motion`.
- **موبایل**: تمام‌صفحه (sheet) با انیمیشن اسلاید.

### ۲-۶. تست‌ها (پذیرش)
| # | سناریو | معیار پذیرش |
|---|---|---|
| ۱ | سلام + پرسشmeasureها | پاسخ با راهنمای سایز + `suggestions` شامل «شروع نیاز‌یاب» |
| ۲ | پرسش برند خاص | لیست برندها + لینک جستجو |
| ۳ | پرسش نامربوط (سیاسی/پزشکی) | `handoff: "wizard"` + پیام مهربانه هدایت |
| ۴ | بدون تنظیمات AI | `REQUIRES_CREDENTIAL` بدون فراخوانی بیرونی |
| ۵ | Rate-limit فعال | ۴۲۹ با `Retry-After` |
| ۶ | SSE streaming | توکن‌ها به‌تدریج می‌رسند (نه یک‌جا) |
| ۷ | دسترس‌پذیری | Tab/Enter/Esc کار کند، aria-label داریم |

### ۲-۷. چک‌لیست تحویل (Definition of Done)
- [ ] `app/api/ai/chat/route.ts` با اعتبارسنجی، rate-limit، SSE.
- [ ] `lib/ai-client.ts` با retry/timeout، ماسک‌کردن کلید در لاگ.
- [ ] `ChatWidget.tsx` + استایل‌ها، SSR-safe (hydration mismatch نداشته باشد).
- [ ] Unit tests: system prompt، fallback، rate-limit.
- [ ] Integration test: happy path + credentials missing.
- [ ] `pnpm typecheck` سبز.
- [ ] مستندات: اضافه کردن `AI_BASE_URL`، `AI_API_KEY`، `AI_MODEL`، `AI_MAX_TOKENS` در `.env.example` + `docs/deploy-guide.md`.

---

## ۳) تسک ۲: گام ۲۱ — کارایی (F1-8) 🟠

### ۳-۱. اهداف و بودجه‌ها (بخش ۳ برنامهٔ کامل)

| متریک | هدف | ابزار اندازه‌گیری |
|---|---|---|
| LCP (موبایل ۴G) | < 2.5s | Lighthouse CI / web-vitals |
| CLS | < 0.1 | Lighthouse |
| INP | < 200ms | Lighthouse / Chrome DevTools |
| API p95 | < 300ms | k6 / اسکریپت ساده |
| Bundle JS (gzip) | ≤ ۱۵۰ KB | `next build` analyzer |

### ۳-۲. حوزه‌های بهبود (اولویت‌بندی شده)

| حوزه | اقدامات konkrete | فایل‌های هدف |
|---|---|---|
| **تصاویر** | `next/image` با `sizes` دقیق، `priority` روی LCP، آپلود: WebP/AVIF، `quality: 85`، blur placeholder | `ProductCard.tsx`، `ProductArt.tsx`، `ProductGrid.tsx`، `cms/*` |
| **فونت** | Subset فارسی (فقط glyphهای موردنیاز)، `preload`، `font-display: swap`، variable font اگر موجود | `globals.css`، `layout.tsx`، `next.config.ts` |
| **DB Indexes** | `EXPLAIN ANALYZE` روی کوئری‌های داغ (کاتالوگ، سبد، سفارش، نظرات)، اضافه کردن indexهای composite | Prisma schema + migration |
| **Caching** | `revalidateTag` روی `products`/`categories`/`brands`، `stale-while-revalidate` برای HTML، Cache-Control headers صحیح | `catalog-repo.ts`، `cms.ts`، `next.config.ts` |
| **Bundle** | Dynamic import برای کدهای سنگین (چت‌بات، چک‌اوت، ادمین)، حذف وابستگی‌های ناخواسته | `ChatWidget.tsx`، `CheckoutClient.tsx`، `ProductOptions.tsx` |
| **Third-party** | پیش‌اتصال/preload برای دامنه‌های حیاتی (CDN تصاویر، API پرداخت) | `next.config.ts`، `layout.tsx` |

### ۳-۳. Baseline فعلی (قبل از شروع)
اجرای یکباره و ثبت نتایج:
```bash
# Lighthouse CI (mobile, 4G throttle)
npx lhci autorun --config=lighthouserc.json

# API p95 (k6 یا اسکریپت ساده)
node scripts/api-perf.mjs  # ۳۰ ثانیه، ۵۰ VU
```
**خروجی baseline:** فایل JSON با timestamp در `docs/perf-baseline-<date>.json`.

### ۳-۴. طرح اجرا (Iterative)
1. **هفته ۱:** تصاویر + فونت (بیشترین تأثیر بر LCP/CLS).
2. **هفته ۲:** ایندکس‌های DB + کش (تأثیر بر API p95).
3. **هفته ۳:** Bundle splitting + third-party (تأثیر بر INP/TTI).
4. **هر ایتریشن:** build → Lighthouse → مقایسه با baseline → کامیت اگر بهبودی ≥۵٪.

### ۳-۵. پذیرش (Definition of Done)
- [ ] جدول قبل/بعد با حداقل **۳ متریک** بهبود یافته (مثلاً LCP -۳۰٪، API p95 -۴۰٪، Bundle -۲۰٪).
- [ ] تمام اهداف عددی بخش ۳ برآورده شده‌اند.
- [ ] `pnpm typecheck` و `pnpm build` سبز.
- [ ] گزارش نهایی در `docs/perf-report.md` با نمودار/شاهد.

---

## ۴) موارد معلق/نیازمندان (از موج ۱ و ۲)

| مورد | دلیل معلق بودن | اقدام در مستندات |
|---|---|---|
| **اعتبار پیامک** | API credit در کاوه‌نگار/سایر Providerها موجود نیست | در `deploy-guide.md`: «پنل ارائه‌دهنده هشدار می‌دهد؛ اگر API اضافه شد، webhook به `/admin/capabilities/alerts` وصل شود» |
| **تطبیق کامل تسویه درگاه** | منطق مقایسه مستقل کامل نیست | در `deploy-guide.md`: «هوک در `payments.service.ts` + گزارش در health/diagnostics؛ هشدار خودکار بعداً» |
| **2FA نقش‌های مالی** | تصمیم #۹: بعد از لانچ | در `deploy-guide.md`: «گام ۲۲-ب: بعد از لانچ، TOTP برای نقش‌های `finance`/`admin`» |
| **مترادف‌های جستجو** | وابسته به گام ۲۰ (SEO/اسلاگ) | در `deploy-guide.md`: «چت‌بات باید از `lib/search-synonyms.ts` استفاده کند؛ بعد از قفل اسلاگ تکمیل شود» |
| **مانیتورینگ زنده (گام ۲۳/۳۸-۱)** | نیازمند VPS/دامنه واقعی | در `deploy-guide.md`: چک‌لیست uptime + هشدار تلگرام/ایمیل + دیسک/CPU |

---

## ۵) گزارش پایانی موج ۲ (Template)

وقتی هر دو تسک تمام شد، این خلاصه را تولید کن:

```markdown
# گزارش موج ۲ — <تاریخ>

## ۱. چت‌بات (گام ۱۸-۳)
- **فایل‌های تغییر یافته:** [لیست]
- **پذیرش‌های اجرا/سبز:** [شماره تست‌ها]
- **معلق/ننشده:** [مثلاً: budget روزانه پیاده نشد چون env اضافه نشد]

## ۲. کارایی (گام ۲۱)
- **Baseline:** [لینک فایل JSON]
- **After:** [لینک فایل JSON]
- **بهبودی‌ها:** [جدول متریک → قبل/بعد/درصد]
- **پذیرش‌های اجرا/سبز:** Lighthouse CI سبز، k6 p95 < 300ms

## ۳. Typecheck + Build
- `pnpm typecheck`: ✅/❌
- `pnpm build`: ✅/❌

## ۴. Env جدید
- `AI_BASE_URL`، `AI_API_KEY`، `AI_MODEL`، `AI_MAX_TOKENS`

## ۵. وابستگی به موج‌های بعدی
- چت‌بات → مترادف‌های جستجو (گام ۲۰) برای دقت بهتر
- کارایی → مانیتورینگ p95 مداوم (گام ۲۳/۳۸-۱)
```

---

## ۶) چک‌لیست سریع اجرا (برای کپی در ترمینال/تسک‌مเนجر)

```
[ ] ۱۸-۳: AI chat endpoint + SSE + rate-limit
[ ] ۱۸-۳: AI client (OpenAI-compatible, masked logging)
[ ] ۱۸-۳: System prompt + fallback to wizard
[ ] ۱۸-۳: ChatWidget (accessible, themed, SSR-safe)
[ ] ۱۸-۳: Unit + Integration tests
[ ] ۱۸-۳: Docs (.env.example, deploy-guide)
[ ] ۱۸-۳: Typecheck سبز
[ ] ۲۱:  Baseline Lighthouse + API p95 (ذخیره JSON)
[ ] ۲۱:  Images: sizes, priority, WebP/AVIF, blur
[ ] ۲۱:  Fonts: subset, preload, swap, variable
[ ] ۲۱:  DB indexes: EXPLAIN + migration
[ ] ۲۱:  Caching: revalidateTag, SWR, headers
[ ] ۲۱:  Bundle: dynamic imports, analyzer
[ ] ۲۱:  Third-party: preconnect/dns-prefetch
[ ] ۲۱:  After measurements + report (۳+ بهبود)
[ ] ۲۱:  Typecheck + Build سبز
[ ]  گزارش پایانی موج ۲ (template بالا)
```

---

## ۷) نکات کلیدی برای «یک‌درخواست-تکمیل»

> اگر می‌خواهی با **یک درخواست** همه را تمام کنی، این دستور را بده:
>
> > «موج ۲ را کامل اجرا کن: گام ۱۸-۳ (چت‌بات) و گام ۲۱ (کارایی) به ترتیب اولویت، با تمام تست‌ها، typecheck، و گزارش پایانی. موارد معلق را در deploy-guide.md مستند کن.»
>
> عامل باید:
> ۱. هر تسک را در یکBranch/PR جداگانه انجام دهد.
> ۲. پس از هر تسک: `pnpm typecheck` + تست‌های مربوطه سبز باشد.
> ۳. در انتها، گزارش پایانی (بخش ۵) را تحویل دهد.
> ۴. هیچ کد ساختگی ننویسد — موارد ناقص را صریح در مستندات ثبت کند.