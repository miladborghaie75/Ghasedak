/**
 * متن‌هایی که **هم** رابط کاربری و **هم** محتوای صفحه‌های ایستا لازم دارند.
 *
 * نمونه: «راهنمای سایز» هم دکمهٔ ورود به راهنمای سایز است و هم عنوانِ بخشی
 * در صفحهٔ «دربارهٔ ما». اگر این متن در دو جا نوشته شود، یک روز عوض می‌شود
 * و آن‌وقت در یکی از دو جا غلط می‌ماند — پس اینجا یک‌بار نوشته می‌شود و
 * هر دو طرف از همین می‌خوانند.
 */

/** متن‌های مشترک رابط و محتوا */
export const SHARED_COPY = {
  /** راهنمای تعیین سایز — دکمه‌های سایت و عنوان بخش در صفحهٔ «دربارهٔ ما» */
  sizeGuide: "راهنمای سایز",
} as const;

/**
 * عنوانِ فارسی صفحه‌های محتوایی/حقوقی — در نوارِ پیمایشِ همان صفحه‌ها،
 * فوتر و برگهٔ متادیتا استفاده می‌شود.
 *
 * چرا اینجاست و نه در فروشگاه؟ چون پکیج بلوک‌ها (`@ghasedak/blocks`) باید
 * نوارِ پیمایشِ صفحه‌های محتوایی را رندر کند — هم در سایت و هم در بوم
 * صفحه‌ساز — و پکیج نمی‌تواند از `apps/*` چیزی بخواند. پس این برچسب‌ها به
 * خانهٔ مشترک منتقل شدند و فروشگاه از همین‌جا می‌خواند (تک‌منبعی بودنِ متن،
 * قاعدهٔ R6 در `copy-rules.mjs`).
 */
export const LEGAL_PAGE_TITLES = {
  about: "درباره ما",
  returns: "شرایط بازگشت کالا",
  shipping: "روش‌های ارسال",
  terms: "قوانین و مقررات",
  privacy: "حریم خصوصی",
  contact: "تماس با ما",
} as const;

/** برچسب‌های چارچوبِ صفحهٔ محتوایی (بازگشت، مسیر، تاریخ به‌روزرسانی) */
export const CONTENT_PAGE_COPY = {
  backToStore: "بازگشت به فروشگاه",
  breadcrumb: "مسیر صفحه",
  updatedPrefix: "آخرین به‌روزرسانی:",
} as const;

/**
 * نوارِ پیمایشِ صفحه‌های محتوایی — ترتیب همان چیزی است که سایت امروز دارد.
 * خانه در این فهرست نیست چون نوارِ پیمایش فقط برای همنشین‌های محتوایی است.
 */
export const CONTENT_PAGE_NAV: ReadonlyArray<{ slug: string; href: string; title: string }> = [
  { slug: "about", href: "/about", title: LEGAL_PAGE_TITLES.about },
  { slug: "returns", href: "/returns", title: LEGAL_PAGE_TITLES.returns },
  { slug: "shipping", href: "/shipping", title: LEGAL_PAGE_TITLES.shipping },
  { slug: "terms", href: "/terms", title: LEGAL_PAGE_TITLES.terms },
  { slug: "privacy", href: "/privacy", title: LEGAL_PAGE_TITLES.privacy },
  { slug: "contact", href: "/contact", title: LEGAL_PAGE_TITLES.contact },
];

/* ═══════════ ناوبریِ صفحه‌های محتوایی — قابل‌ویرایش از پنل ═══════════ */

/**
 * ناوبریِ ثابت نبود: مدیر باید می‌توانست **نام** هر گزینه را عوض کند،
 * **ترتیب**شان را بچیند و بعضی را از نوار **پنهان** کند (بند اولویتِ ۱ در
 * چک‌لیستِ صفحه‌ساز). تصمیم‌ها:
 *
 *  ۱) `href` همیشه از `CONTENT_PAGE_NAV` می‌آید — مدیر مسیر را عوض نمی‌کند،
 *     پس پیوندِ شکسته در سایت ممکن نیست.
 *  ۲) «حذف» یعنی `visible: false` — صفحه هست و از آدرس باز می‌شود، فقط از
 *     نوار پیوندش نیست. گزینه‌ای که اصلاً ذخیره نشود به پیش‌فرض برمی‌گردد،
 *     پس ذخیرهٔ ناقص هرگز صفحه‌ای را از سایت جا نمی‌اندازد.
 *  ۳) خواندنِ ذخیره «دفاعی» است: slug ناشناخته، تکرار یا شکلِ خراب بی‌صدا
 *     کنار گذاشته می‌شود — یک مقدار خراب نباید نوارِ سایت را خالی کند.
 *     ولی **نوشتن** سخت‌گیرانه است (`normalizeContentNavInput`)؛ خطا باید
 *     به چشم مدیر بیاید، نه اینکه بی‌صدا پاک شود.
 */

/** یک گزینهٔ ناوبری — همان چیزی که سایت و بوم رندر می‌کنند */
export interface ContentNavItem {
  slug: string;
  href: string;
  title: string;
}

/** ردیفِ کامل برای پنل — پنهان‌ها را هم دارد تا دکمهٔ «نمایش» بتواند برگرداندشان */
export interface ContentNavRow extends ContentNavItem {
  visible: boolean;
}

/** تنظیمِ ذخیره‌شدهٔ یک گزینه (شکلِ ورودیِ پنل و شکلِ ذخیره در `Setting`) */
export interface ContentNavConfigItem {
  slug: string;
  /** عنوانِ سفارشی — غایب یا خالی یعنی برچسبِ پیش‌فرض */
  title?: string;
  /** `false` یعنی از نوار پنهان است؛ غایب یعنی نمایان */
  visible?: boolean;
}

/** کلیدِ ذخیره در جدول `Setting` — فروشگاه، پنل و API همین را می‌شناسند */
export const CONTENT_NAV_SETTING_KEY = "cms.contentNav";

/** حداکثر طولِ عنوانِ ناوبری — جلوی پر شدنِ نوار با متنِ بلند */
export const CONTENT_NAV_TITLE_MAX = 60;

/** خواندنِ امنِ تنظیمِ ذخیره‌شده — فقط شکلِ درست را می‌پذیرد، بقیه را می‌اندازد */
function readNavConfig(config: unknown): ContentNavConfigItem[] {
  const raw = Array.isArray(config)
    ? config
    : config && typeof config === "object" && Array.isArray((config as { items?: unknown }).items)
      ? ((config as { items: unknown[] }).items as unknown[])
      : [];
  const out: ContentNavConfigItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.slug !== "string" || !e.slug.trim()) continue;
    const item: ContentNavConfigItem = { slug: e.slug.trim(), visible: e.visible !== false };
    if (typeof e.title === "string" && e.title.trim()) item.title = e.title.trim();
    out.push(item);
  }
  return out;
}

/**
 * ناوبریِ کامل با ترتیبِ ذخیره‌شده — شامل گزینه‌های پنهان.
 * گزینه‌ای که در تنظیم نیست به ترتیبِ پیش‌فرضِ `CONTENT_PAGE_NAV` می‌آید.
 */
export function resolveContentNavAll(config: unknown): ContentNavRow[] {
  const overrides = new Map<string, ContentNavConfigItem>();
  const order: string[] = [];
  for (const item of readNavConfig(config)) {
    if (!CONTENT_PAGE_NAV.some((d) => d.slug === item.slug)) continue; // ناشناخته → بی‌اثر
    if (overrides.has(item.slug)) continue; // تکراری → اولینِ فهرست برنده
    overrides.set(item.slug, item);
    order.push(item.slug);
  }
  const rest = CONTENT_PAGE_NAV.filter((d) => !order.includes(d.slug)).map((d) => d.slug);

  return [...order, ...rest].map((slug) => {
    const def = CONTENT_PAGE_NAV.find((d) => d.slug === slug) as (typeof CONTENT_PAGE_NAV)[number];
    const o = overrides.get(slug);
    return {
      slug: def.slug,
      href: def.href,
      title: o?.title?.trim() || def.title,
      visible: o?.visible !== false,
    };
  });
}

/** فقط گزینه‌های نمایان — همان چیزی که سایت و بوم رندر می‌کنند */
export function resolveContentNav(config: unknown): ContentNavItem[] {
  return resolveContentNavAll(config)
    .filter((r) => r.visible)
    .map(({ slug, href, title }) => ({ slug, href, title }));
}

/**
 * اعتبارسنجیِ ورودیِ پنل پیش از ذخیره.
 *
 * برخلافِ خواندن، این‌جا هر اشکال **خطا** است: مدیر باید بفهمد چه فرستاده،
 * نه اینکه بی‌صدا نادیده گرفته شود. خروجی یا `{ items }` (همهٔ برچسب‌های
 * پیش‌فرض حذف‌شده تا ذخیره کوچک بماند و تغییرِ بعدیِ برند اعمال شود) یا
 * `{ error }` است.
 */
export function normalizeContentNavInput(
  input: unknown,
): { items: ContentNavConfigItem[] } | { error: string } {
  if (!Array.isArray(input)) return { error: "ناوبری باید فهرستی از گزینه‌ها باشد." };

  const items: ContentNavConfigItem[] = [];
  const seen = new Set<string>();
  for (const entry of input) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { error: "هر گزینهٔ ناوبری باید شیءی باشد که slug دارد." };
    }
    const e = entry as Record<string, unknown>;
    const slug = typeof e.slug === "string" ? e.slug.trim() : "";
    const def = CONTENT_PAGE_NAV.find((d) => d.slug === slug);
    if (!def) {
      return { error: `«${String(e.slug ?? "").slice(0, 40) || "بدون شناسه"}» در ناوبری صفحه‌های محتوایی نیست.` };
    }
    if (seen.has(slug)) return { error: `گزینهٔ «${def.title}» دوبار آمده است.` };
    seen.add(slug);
    if (e.title !== undefined && typeof e.title !== "string") {
      return { error: "عنوانِ ناوبری باید متن باشد." };
    }
    if (e.visible !== undefined && typeof e.visible !== "boolean") {
      return { error: "وضعیتِ نمایشِ ناوبری باید درست یا غلط باشد." };
    }
    const title = typeof e.title === "string" ? e.title.trim() : "";
    if (title.length > CONTENT_NAV_TITLE_MAX) {
      return { error: `عنوانِ ناوبری بیش از ${CONTENT_NAV_TITLE_MAX} نویسه است.` };
    }

    const item: ContentNavConfigItem = { slug };
    if (title && title !== def.title) item.title = title;
    if (e.visible === false) item.visible = false;
    items.push(item);
  }
  return { items };
}
