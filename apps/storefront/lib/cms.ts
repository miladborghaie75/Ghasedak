import type { Metadata } from "next";
import type { CmsPageData, ContentNavItem } from "@ghasedak/contracts";
import type { CmsData, CmsProduct } from "@ghasedak/blocks";
import { CATEGORIES } from "./categories";
import { guides } from "./guides-data";
import { hasAnyStock, isNewProduct, minPrice, salePriceOf } from "./catalog-repo";
import type { ProductV2 } from "./catalog";

/**
 * اتصال فروشگاه به صفحه‌ساز.
 *
 * دو کار می‌کند:
 *  ۱) خواندن صفحهٔ CMS از API (فقط صفحهٔ منتشرشده — مگر پیش‌نمایش)
 *  ۲) تبدیل کاتالوگ واقعی به شکلی که بلوک‌ها می‌خواهند
 *
 * فروشگاه هرگز مستقیم DB را نمی‌خواند (بند ۵) — همه از API.
 */

/** تبدیل کاتالوگ واقعی به دادهٔ بلوک‌ها — بدون ساختن دادهٔ جعلی */
export function buildCmsData(products: ProductV2[]): CmsData {
  const list: CmsProduct[] = products.map((p) => {
    const sale = salePriceOf(p);
    const base = minPrice(p);
    const compareAt = sale != null && sale < base ? base : null;
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      // اگر تخفیف هست قیمت اصلی به‌عنوان compareAt می‌رود، وگرنه همان قیمت پایه
      price: sale ?? base,
      compareAt,
      imageUrl: null,
      badge: sale != null && sale < base ? "تخفیف" : null,
      isNew: isNewProduct(p),
      inStock: hasAnyStock(p),
    };
  });

  return {
    products: list,
    categories: CATEGORIES.map((c) => {
      // آیکون از API عمومی خوانده می‌شود؛ اگر نبود همان لیست ثابت مبناست
      const live = liveCategories.get(c.slug);
      return { slug: c.slug, name: c.name, blurb: live?.blurb ?? c.blurb, imageUrl: live?.imageUrl ?? null };
    }),
    guides: Object.entries(guides).map(([slug, g]) => ({
      slug,
      title: typeof g === "object" && g !== null && "title" in g ? String(g.title) : slug,
    })),
    brands: liveBrands,
    // ناوبریِ صفحه‌های محتوایی از تنظیمِ پنل — غایب یعنی تنظیمی نیست → پیش‌فرض
    nav: liveNav ?? undefined,
  };
}

/** برندهای زنده با لوگو — یک‌بار در هر پردازش */
let liveBrands: Array<{ slug: string; name: string; logoUrl: string | null }> = [];

/**
 * بارگذاری برندها از API عمومی.
 * اگر API در دسترس نبود، فهرست خالی می‌ماند و بلوک برند حالت «خالی»
 * صادقانه نشان می‌دهد — برند ساختگی نمایش داده نمی‌شود.
 */
export async function loadLiveBrands(): Promise<void> {
  if (liveBrands.length > 0) return;
  const api = process.env.API_ORIGIN ?? "http://localhost:4000";
  try {
    const r = await fetch(`${api}/api/v1/catalog/brands`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(4_000),
    });
    if (!r.ok) return;
    const body = (await r.json()) as {
      items?: Array<{ slug: string; name: string; logoUrl?: string | null }>;
    };
    liveBrands = (body.items ?? []).map((b) => ({ slug: b.slug, name: b.name, logoUrl: b.logoUrl ?? null }));
  } catch {
    // بی‌خطر
  }
}

/** دسته‌های زنده با آیکون — یک‌بار در هر پردازش خوانده می‌شود */
let liveCategories: Map<string, { blurb?: string; imageUrl: string | null }> = new Map();

/**
 * بارگذاری آیکون دسته‌ها از API عمومی.
 *
 * لیست ثابت `CATEGORIES` مرجع نام/اسلاگ است (برای پایداری مسیرها)، ولی
 * آیکون و توضیح باید زنده باشد تا مدیر بتواند از پنل عوضشان کند.
 * اگر API در دسترس نبود، بی‌سروصدا از همان لیست ثابت استفاده می‌شود.
 */
export async function loadLiveCategories(): Promise<void> {
  if (liveCategories.size > 0) return;
  const api = process.env.API_ORIGIN ?? "http://localhost:4000";
  try {
    const r = await fetch(`${api}/api/v1/catalog/categories`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(4_000),
    });
    if (!r.ok) return;
    const body = (await r.json()) as {
      items?: Array<{ slug: string; description?: string | null; imageUrl?: string | null }>;
    };
    const map = new Map<string, { blurb?: string; imageUrl: string | null }>();
    for (const c of body.items ?? []) {
      map.set(c.slug, { blurb: c.description ?? undefined, imageUrl: c.imageUrl ?? null });
    }
    liveCategories = map;
  } catch {
    // بی‌خطر — فروشگاه با لیست ثابت ادامه می‌دهد
  }
}

/**
 * ناوبریِ صفحه‌های محتوایی (نام/ترتیب/نمایش) از تنظیمِ پنل.
 *
 * همان سه اصلِ `maintenance.ts`:
 *  ۱) **fail-open**: اگر API در دسترس نبود، آخرین ناوبریِ دیده‌شده می‌ماند
 *     و اگر اصلاً نبود، `null` یعنی ناوبریِ پیش‌فرضِ قرارداد — قطعی API
 *     نباید نوارِ شش صفحه را از سایت جا بیندازد.
 *  ۲) TTL کوتاه (۱۵ ثانیه): تغییرِ پنل سریع اعمال می‌شود بدون بارِ هر درخواست.
 *  ۳) فقط همین‌جا فرمِ پاسخ را می‌شناسد.
 */
const NAV_TTL_MS = 15_000;
let navCache: { at: number; items: ContentNavItem[] } | null = null;
let liveNav: ContentNavItem[] | null = null;

export async function loadLiveContentNav(): Promise<ContentNavItem[] | null> {
  if (navCache && Date.now() - navCache.at < NAV_TTL_MS) return navCache.items;
  const api = process.env.API_ORIGIN ?? "http://localhost:4000";
  try {
    const r = await fetch(`${api}/api/v1/admin/public/content-nav`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_500),
    });
    if (r.ok) {
      const body = (await r.json()) as { items?: unknown };
      const items = Array.isArray(body.items) ? (body.items as ContentNavItem[]) : [];
      liveNav = items;
      navCache = { at: Date.now(), items };
      return items;
    }
  } catch {
    // fail-open — به آخرین ناوبریِ دیده‌شده برمی‌گردیم (یا پیش‌فرض)
  }
  return liveNav;
}

export interface CmsFetchResult {
  page: CmsPageData;
  status: string;
  preview: boolean;
}

/**
 * خواندن صفحه از API.
 * `found:false` یعنی برای این slug صفحه‌ای وجود ندارد یا منتشر نشده —
 * در آن حالت فروشگاه چیدمان پیش‌فرض خودش را نشان می‌دهد.
 *
 * چرا `no-store` و نه `revalidate`:
 *  با `revalidate` صفحه چند ده ثانیه از نسخهٔ قبلی نشان داده می‌شد و مدیر
 *  بعد از «انتشار در سایت» تغییرش را نمی‌دید. یک صفحه‌ساز که بلافاصله
 *  اعمال نشود بی‌فایده است، پس تازگی بر سرعت مقدم است. (اندازه‌گیری نشان
 *  داد این تصمیم فقط چند ده میلی‌ثانیه تفاوت دارد؛ تایم‌اوت کوتاه زیر
 *  تضمین می‌کند API کند صفحه را معطل نکند.)
 *
 * تایم‌اوت ۲.۵ ثانیه: اگر API در دسترس نبود، فروشگاه سریع به چیدمان
 * پیش‌فرض می‌افتد به‌جای اینکه صفحه معطل بماند.
 */
export async function fetchCmsPage(slug: string, preview = false): Promise<CmsFetchResult | null> {
  const api = process.env.API_ORIGIN ?? "http://localhost:4000";
  const url = `${api}/api/v1/cms/page/${encodeURIComponent(slug)}${preview ? "?preview=1" : ""}`;
  try {
    const r = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_500),
      headers: preview ? { cookie: await cookieHeader() } : undefined,
    });
    if (!r.ok) return null;
    const body = (await r.json()) as
      | { found: false }
      | { found: true; data: CmsPageData; status: string; preview: boolean };
    if (!body.found) return null;
    return { page: body.data, status: body.status, preview: body.preview };
  } catch {
    return null;
  }
}

/** شکل پارامترهای جست‌وجوی صفحه (Next 15 آن را Promise می‌دهد) */
export type PreviewParams = Record<string, string | string[] | undefined>;

/**
 * آیا درخواست پیش‌نمایش از پنل صفحه‌ساز آمده؟
 *
 * پنل، صفحهٔ واقعی را داخل iframe با `?cmsPreview=1` باز می‌کند. همین
 * پرچم باعث می‌شود:
 *  ۱) API نسخهٔ «پیش‌نویس» صفحه را هم بدهد (نه فقط منتشرشده)؛
 *  ۲) فروشگاه به‌جای رندر ساده، «سطح پیش‌نمایش» را بگذارد که با پنل حرف می‌زند.
 *
 * در Next 15 پارامترهای جست‌وجو فقط از طریق prop صفحه می‌آیند (نه
 * `next/headers`)، پس صفحه آن را به `CmsSlot` می‌دهد.
 */
export function isPreview(sp: PreviewParams | undefined): boolean {
  const raw = sp?.cmsPreview;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "1" || v === "true";
}

/** نتیجهٔ resolve — وضعیت صفحه به‌همراه اینکه در حالت پیش‌نمایش هستیم یا نه */
export interface CmsSlotResult {
  /** صفحهٔ CMS این مسیر — `null` یعنی هنوز چیزی ساخته نشده */
  page: CmsPageData | null;
  status: string | null;
  /** نسخهٔ پیش‌نویس (منتشر نشده) است؟ */
  draft: boolean;
  /** درخواست از پنل صفحه‌ساز آمده؟ */
  previewMode: boolean;
}

/**
 * حلّ یک «جایگاه صفحه» روی مسیر واقعی سایت.
 *
 * `page === null` یعنی برای این مسیر صفحه‌ای در صفحه‌ساز نیست → فروشگاه
 * چیدمان پیش‌فرض خودش را نشان می‌دهد. ولی در حالت پیش‌نمایش باز هم
 * `previewMode` روشن است، چون پنل باید بتواند پیش‌نویس را بفرستد.
 */
export async function resolveCmsSlot(slug: string, previewMode: boolean): Promise<CmsSlotResult> {
  const res = await fetchCmsPage(slug, previewMode);
  if (!res) return { page: null, status: null, draft: false, previewMode };
  return { page: res.page, status: res.status, draft: res.preview, previewMode };
}

/**
 * کوکی نشست ادمین برای پیش‌نمایش — در Next 15 کوکی‌ها async خوانده می‌شوند.
 * اگر در دسترس نبود، پیش‌نمایش به حالت عمومی برمی‌گردد (بی‌خطر).
 */
async function cookieHeader(): Promise<string> {
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    const v = jar.get("ghasedak_admin_session")?.value;
    return v ? `ghasedak_admin_session=${v}` : "";
  } catch {
    return "";
  }
}

/** آیا صفحه‌ای برای این slug منتشر شده؟ — برای metadata و مسیرها */
export async function hasPublishedPage(slug: string): Promise<boolean> {
  const api = process.env.API_ORIGIN ?? "http://localhost:4000";
  try {
    const r = await fetch(`${api}/api/v1/cms/page/${encodeURIComponent(slug)}`, {
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) return false;
    const body = (await r.json()) as { found: boolean };
    return body.found === true;
  } catch {
    return false;
  }
}

/** slug صفحهٔ اصلی — نگاشت مسیر «/» به صفحهٔ CMS */
export const HOME_SLUG = "home";

/**
 * متادیتای صفحه‌های محتوایی (درباره ما، تماس، قوانین، حریم، ارسال، بازگشت).
 *
 * تا پیش از این این صفحه‌ها `metadata` ثابت داشتند؛ یعنی سئویی که مدیر در
 * صفحه‌ساز می‌نوشت هرگز روی سایت اعمال نمی‌شد (برخلاف مسیر پویای `[slug]`).
 * حالا قاعده یکی است: اگر صفحهٔ منتشرشده سئو دارد، همان اعمال می‌شود؛
 * وگرنه عنوان و توضیح پیش‌فرضِ همان صفحه می‌ماند.
 */
export async function contentPageMetadata(opts: {
  slug: string;
  /** عنوان پیش‌فرض — همان چیزی که در فوتر و ناوبری می‌آید */
  title: string;
  /** توضیح پیش‌فرض — سئوی ثابتی که پیش از صفحه‌ساز نوشته شده بود */
  description: string;
}): Promise<Metadata> {
  const cms = await fetchCmsPage(opts.slug);
  const seo = cms?.page.seo;
  const seoTitle = seo?.title?.trim();
  const seoDescription = seo?.description?.trim();
  const base = seoTitle || opts.title;
  return {
    // نام برند اینجا اضافه **نمی‌شود**: قالبِ عنوان در `app/layout.tsx` خودش
    // « | قاصدک» را می‌گذارد. قبلاً هر دو انجام می‌شد و سطرِ تبِ شش صفحه
    // این‌طور بود: «درباره ما — لباس زیر قاصدک | قاصدک». مدیر فقط عنوانِ خودِ
    // صفحه را می‌نویسد؛ نام فروشگاه از یک جا (قالب) می‌آید.
    title: base,
    description: seoDescription || opts.description,
    ...(seo?.noIndex ? { robots: { index: false, follow: false } } : {}),
  };
}
