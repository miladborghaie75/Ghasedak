/**
 * قرارداد صفحه‌ساز — منبع یکتای حقیقت برای «بلوک‌های از پیش ساخته‌شده».
 *
 * اصل معماری (از الگوی Puck / OpenPage):
 *   JSON تنها منبع حقیقت است. هر نوع بلوک یک تعریف دارد که شامل
 *   فیلدهای قابل ویرایش + مقادیر پیش‌فرض است. ادمین فرم را از روی همین
 *   تعریف می‌سازد و فروشگاه رندر را از روی همین تعریف — پس هیچ‌وقت
 *   لیست فیلدها در دو جا تکرار نمی‌شود و از هم جدا نمی‌افتند.
 *
 * این فایل عمداً «بدون React» است تا هم در ادمین و هم در فروشگاه
 * (سرور و کلاینت) قابل استفاده باشد.
 */

/** انواع بلوک‌های قابل ساخت */
export const CMS_BLOCK_TYPES = [
  "HERO",
  "BANNER",  "CATEGORY_GRID",
  "ART_SHOWCASE",
  "BRAND_GRID",
  "PRODUCT_CAROUSEL",
  "PRODUCT_GRID",
  "FEATURE_TRIPLE",
  "IMAGE_TEXT",
  "RICH_TEXT",
  "STATS",
  "FAQ",
  "TESTIMONIALS",
  "NEWSLETTER",
  "TRUST_BAR",
  "SPACER",
] as const;

export type CmsBlockType = (typeof CMS_BLOCK_TYPES)[number];

/** نوع هر فیلد — رندر فرم در ادمین از روی همین انواع انجام می‌شود */
export type CmsFieldType =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "select"
  | "link"
  | "image"
  | "list";

/**
 * نوع فیلدهای داخل یک سطر لیست.
 *
 * چرا جدا از `CmsFieldType`؟ چون «انتخابگر رنگ» و «پیش‌نمایش آرت» فقط
 * داخل سطرهای لیست معنا دارند — در سطح بلوک چنین کنترلی وجود ندارد.
 */
export type CmsItemFieldType = "text" | "textarea" | "swatch" | "art";

export interface CmsFieldOption {
  value: string;
  label: string;
  /** متغیر CSS رنگ — برای نمایش نمونهٔ رنگ در پنل (مثل `var(--color-sage)`) */
  cssVar?: string;
}

/** یک ستون از سطرهای لیست */
export interface CmsItemField {
  key: string;
  label: string;
  type: CmsItemFieldType;
  placeholder?: string;
  options?: CmsFieldOption[];
  /** برای نوع `art`: کلید ستونی که رنگ قاب را نگه می‌دارد */
  colorFrom?: string;
  /** فقط برای متن: سقفِ طولِ مقدار — توضیح و نشانِ قاب جای جمله‌ی بلند نیستند */
  maxLength?: number;
}

export interface CmsField {
  key: string;
  label: string;
  type: CmsFieldType;
  help?: string;
  placeholder?: string;
  /** برای select */
  options?: CmsFieldOption[];
  /** برای number */
  min?: number;
  max?: number;
  step?: number;
  /** برای list: تعداد سطرهای قابل ویرایش */
  listRows?: number;
  /**
   * برای list: تعداد سطرها **ثابت** است — مدیر نمی‌تواند سطری اضافه یا حذف
   * کند، فقط ترتیب و مقدارها را عوض می‌کند. برای قفسهٔ فرم‌های برند لازم است:
   * شکلِ قفسه (شش فرمِ شناخته‌شده) از قرارداد برند می‌آید، نه از سلیقهٔ مدیر.
   */
  listFixed?: boolean;
  /** فقط برای یک نوع خاص بلوک نمایش داده شود (مثال: "HERO|BANNER") */
  onlyFor?: CmsBlockType[];
  /** برای list: ستون‌های هر آیتم */
  itemFields?: CmsItemField[];
}

/* ─────────────────── قفسهٔ فرم‌ها: فرم‌ها و پالت برند ─────────────────── */

/**
 * فرم‌های محصولِ برند — همان شش قابِ ثابتِ «نمونه‌کار آرت».
 *
 * این فهرست *قرارداد برند* است، نه فهرست دلخواه: قیفِ فروشگاه دقیقاً همین
 * شش دسته را دارد و آرتِ اختصاصی هر فرم (سوتین، شورت، ست، گن، ورزشی،
 * لباس خواب) برای همین‌ها کشیده شده. مدیر می‌تواند **ترتیب** و **رنگ** را
 * عوض کند، ولی فرمِ قاب‌ها و شماره‌شان عوض نمی‌شود — وگرنه زبان بصریِ
 * برند می‌شکند.
 */
export type ArtFrameKind = "bra" | "panty" | "set" | "shapewear" | "sport" | "sleepwear";

export interface ArtFrameKindDef {
  value: ArtFrameKind;
  /** نام فارسی فرم — همان نامی که در دستهٔ زندهٔ فروشگاه می‌بینی */
  label: string;
  /** اسلاگ دسته در فروشگاه (لینک قاب) */
  slug: string;
}

export const ART_FRAME_KINDS: ArtFrameKindDef[] = [
  { value: "set", label: "ست لباس زیر", slug: "set" },
  { value: "bra", label: "سوتین", slug: "bra" },
  { value: "panty", label: "شورت", slug: "panty" },
  { value: "shapewear", label: "گن", slug: "shapewear" },
  { value: "sport", label: "ورزشی", slug: "sport" },
  { value: "sleepwear", label: "لباس خواب", slug: "sleepwear" },
];

/**
 * پالت رنگِ قاب‌های آرت — فقط از توکن‌های برند، نه hex آزاد.
 *
 * چرا رنگ آزاد ممنوع است؟ رنگِ قاب‌ها بخشی از زبان بصری برند است: چهار
 * رنگِ ثابت (بنفش برند، بنفش تیره، سبز خاکی، صورتی خاکی) که در هر دو تم
 * روشن و شب خوانا می‌مانند. اگر مدیر hex دلخواه بگذارد، قفسه به یک جعبهٔ
 * رنگِ تصادفی تبدیل می‌شود. پس انتخابگر پنل فقط همین چهار رنگ را نشان
 * می‌دهد و سمت API هم هر مقدار بیرون از این پالت را دور می‌ریزد.
 *
 * چرا توکن‌های `art-*` و نه توکن‌های متن (`--color-plum` و…)؟
 * «بنفش تیره» دو نقش جدا دارد: رنگِ متنِ تیترها (که در تم شب باید روشن
 * باشد تا خوانده شود) و رنگِ قابِ آرت (که باید در هر دو تم *متمایز* بماند).
 * با یک توکنِ مشترک، در تم شب «بنفش برند» و «بنفش تیره» هر دو به یک
 * یاسِ کم‌رنگ می‌افتند و دو قابِ جدا یک‌رنگ می‌شوند — یعنی همان
 * شکستنِ زبان بصری که این پالت برای جلوگیری از آن ساخته شده.
 * پس پالتِ آرت توکن‌های خودش را دارد و هر تم آن‌ها را جدا بازنگاشت می‌کند.
 */
export interface ArtFrameColorDef {
  value: string;
  label: string;
  /** متغیر CSS — تنها راه رنگ‌دادن به آرت */
  cssVar: string;
}

export const ART_FRAME_COLORS: ArtFrameColorDef[] = [
  { value: "primary", label: "بنفش برند", cssVar: "var(--color-art-brand)" },
  { value: "plum", label: "بنفش تیره", cssVar: "var(--color-art-plum)" },
  { value: "sage", label: "سبز خاکی", cssVar: "var(--color-art-sage)" },
  { value: "dusty-rose", label: "صورتی خاکی", cssVar: "var(--color-art-rose)" },
];

/** رنگ پیش‌فرض هر فرم — مبنای قفسه وقتی مدیر چیزی را عوض نکرده */
export const ART_FRAME_DEFAULT_COLORS: Record<ArtFrameKind, string> = {
  set: "dusty-rose",
  bra: "primary",
  panty: "sage",
  shapewear: "plum",
  sport: "primary",
  sleepwear: "dusty-rose",
};

/** ترتیب و رنگِ پیش‌فرض قفسه — همان چیزی که امروز روی سایت می‌بینی */
export const ART_FRAME_DEFAULTS: Array<{ kind: ArtFrameKind; color: string }> =
  ART_FRAME_KINDS.map((k) => ({ kind: k.value, color: ART_FRAME_DEFAULT_COLORS[k.value] }));

/** آیا این مقدار یکی از فرم‌های برند است؟ */
export function isArtFrameKind(v: unknown): v is ArtFrameKind {
  return typeof v === "string" && ART_FRAME_KINDS.some((k) => k.value === v);
}

/** آیا این مقدار یکی از رنگ‌های مجاز برند است؟ */
export function isArtFrameColor(v: unknown): boolean {
  return typeof v === "string" && ART_FRAME_COLORS.some((c) => c.value === v);
}

/** متغیر CSS رنگ — برای مقدار نامعتبر، رنگ پیش‌فرض همان فرم */
export function artFrameColorVar(value: unknown, kind: ArtFrameKind): string {
  const found = ART_FRAME_COLORS.find((c) => c.value === value);
  if (found) return found.cssVar;
  const fallback = ART_FRAME_COLORS.find((c) => c.value === ART_FRAME_DEFAULT_COLORS[kind]);
  return fallback?.cssVar ?? "var(--color-art-brand)";
}

/**
 * متنِ کوتاهِ فروشِ هر فرم — توضیحِ یک‌خطی زیرِ نامِ قاب.
 *
 * چرا در قرارداد و نه فقط در پنل؟ چون قفسه باید حتی وقتی مدیر چیزی ننوشته
 * «حرف» داشته باشد؛ همان شش خطِ ثابتِ برند مبنای پیش‌فرض‌اند و مدیر می‌تواند
 * هرکدام را عوض کند. طولشان عمداً یک نفس است: در ستونی به پهنای یک کارت،
 * جملهٔ بلند به دو خط می‌شکند و ردیفِ قاب‌ها را ناتراز می‌کند.
 */
export const ART_FRAME_NOTES: Record<ArtFrameKind, string> = {
  set: "هماهنگ از بالا تا پایین",
  bra: "سبک، برای روزهای بلند",
  panty: "برشِ بی‌خط زیرِ لباس",
  shapewear: "فرم می‌دهد، فشار نمی‌آورد",
  sport: "کششِ آزاد برای تمرین",
  sleepwear: "نرمیِ شب تا صبح",
};

/**
 * نشانِ گوشهٔ قاب — خالی یعنی این فرم نشان ندارد.
 *
 * نشان یک ادعای فروش است (پیشنهاد، تازه، محدود…)، پس فقط جایی می‌نشیند که
 * مدیر صریحاً خواسته باشد؛ به همین دلیل هم «کلیدِ نمایش» جدا از متن دارد و
 * می‌توان نشان را موقتاً خاموش کرد بی‌آنکه متنش پاک شود.
 */
export const ART_FRAME_BADGES: Record<ArtFrameKind, string> = {
  set: "پیشنهاد ما",
  bra: "",
  panty: "",
  shapewear: "",
  sport: "",
  sleepwear: "",
};

/** یک قابِ آمادهٔ رندر — همه‌چیزش از قرارداد برند می‌آید */
export interface ResolvedArtFrame {
  kind: ArtFrameKind;
  /** اسلاگ دسته — لینک قاب */
  slug: string;
  /** نام برندِ فرم (وقتی مدیر برچسب دلخواه نداده) */
  brandLabel: string;
  /** برچسبی که مدیر نوشته (خالی = برچسب برند) */
  customLabel: string;
  /** متغیر CSS رنگ — همیشه از پالت برند */
  color: string;
  /** توضیحِ کوتاهِ فروش — خالی = بی‌توضیح */
  note: string;
  /** متنِ نشانِ گوشه — خالی = نشان ندارد (نشان یک ادعای فروش است، نه پیش‌فرض) */
  badge: string;
}

/**
 * تبدیل props مدیر به شش قابِ قطعی.
 *
 * این تابع *قلبِ* قاعدهٔ «زبان بصری برند» در بلوک نمونه‌کار است:
 *  ۱) **ترتیب** مدیر می‌ماند — تنها چیزی که او کنترل می‌کند؛
 *  ۲) فرمِ ناشناخته یا تکراری حذف می‌شود — هر فرم یک‌بار، مثل خودِ برند؛
 *  ۳) رنگِ بیرون از پالت به رنگ پیش‌فرض همان فرم برمی‌گردد؛
 *  ۴) جای خالی با فرم‌های برند پر می‌شود تا قفسه همیشه شش قاب باشد.
 *
 * چرا در قرارداد و نه در کامپوننت؟ چون باید **قابل تست** باشد (API و سایت
 * یک نتیجه می‌گیرند) و چون API هم باید بتواند همین قاعده را روی payload
 * ناخوانا اجرا کند.
 */
export function resolveArtFrames(rows: unknown): ResolvedArtFrame[] {
  const list = Array.isArray(rows) ? rows : [];
  const out: ResolvedArtFrame[] = [];
  const used = new Set<string>();

  for (const row of list.slice(0, ART_FRAME_KINDS.length)) {
    if (!isPlainObject(row)) continue;
    const kind = row.kind;
    if (!isArtFrameKind(kind) || used.has(kind)) continue;
    used.add(kind);
    const def = ART_FRAME_KINDS.find((k) => k.value === kind);
    if (!def) continue;
    out.push({
      kind,
      slug: def.slug,
      brandLabel: def.label,
      customLabel: typeof row.label === "string" ? row.label.trim() : "",
      color: artFrameColorVar(row.color, kind),
      // توضیحِ خالی به متنِ پیش‌فرضِ همان فرم برمی‌گردد؛ این هم مهاجرتِ صفحه‌های
      // قدیمی (که هنوز این ستون را ندارند) را سالم نگه می‌دارد و هم یعنی مدیر
      // برای «نوشتن» فقط باید تایپ کند، نه نسخه‌برداری از متنِ برند.
      note: (typeof row.note === "string" ? row.note.trim().slice(0, 80) : "") || ART_FRAME_NOTES[kind],
      badge: typeof row.badge === "string" ? row.badge.trim().slice(0, 24) : "",
    });
  }

  for (const def of ART_FRAME_DEFAULTS) {
    if (out.length >= ART_FRAME_KINDS.length) break;
    if (used.has(def.kind)) continue;
    used.add(def.kind);
    const k = ART_FRAME_KINDS.find((x) => x.value === def.kind);
    if (!k) continue;
    out.push({
      kind: def.kind,
      slug: k.slug,
      brandLabel: k.label,
      customLabel: "",
      color: artFrameColorVar(def.color, def.kind),
      // جای خالی هم «حرف» دارد: متنِ پیش‌فرضِ همان فرمِ برند
      note: ART_FRAME_NOTES[def.kind],
      badge: ART_FRAME_BADGES[def.kind],
    });
  }

  return out;
}

export type CmsBlockGroup = "header" | "commerce" | "content" | "social" | "layout";

export interface CmsBlockDef {
  type: CmsBlockType;
  label: string;
  description: string;
  group: CmsBlockGroup;
  /** ایموجی/نماد برای پالت (بدون وابستگی به آیکون‌فونت) */
  glyph: string;
  fields: CmsField[];
  defaults: Record<string, unknown>;
}

export interface CmsBlock {
  id: string;
  type: CmsBlockType;
  props: Record<string, unknown>;
  /** بلوک پنهان — در رندر عمومی نمی‌آید ولی در ادمین هست */
  hidden?: boolean;
}

export interface CmsSeo {
  title?: string;
  description?: string;
  ogImage?: string;
  noIndex?: boolean;
}

export interface CmsPageData {
  /** نسخهٔ اسکیما — برای مهاجرت آینده */
  version: 1;
  title: string;
  seo?: CmsSeo;
  blocks: CmsBlock[];
}

export type CmsPageStatus = "DRAFT" | "PUBLISHED";

export interface CmsPageSummary {
  slug: string;
  title: string;
  status: CmsPageStatus;
  blockCount: number;
  updatedAt: string;
  publishedAt: string | null;
}

/* ─────────────────────────── بلوک‌های آماده ─────────────────────────── */

const linkField = (key: string, label: string): CmsField => ({
  key,
  label,
  type: "link",
  placeholder: "/c/bra یا https://…",
});

const ctaFields: CmsField[] = [
  { key: "ctaLabel", label: "متن دکمه", type: "text", placeholder: "مشاهده محصولات" },
  linkField("ctaHref", "لینک دکمه"),
];

const alignField: CmsField = {
  key: "align",
  label: "چینش",
  type: "select",
  options: [
    { value: "start", label: "راست" },
    { value: "center", label: "وسط" },
  ],
};

export const CMS_BLOCK_DEFS: Record<CmsBlockType, CmsBlockDef> = {
  HERO: {
    type: "HERO",
    label: "هیرو (بزرگ‌ترین بلوک)",
    description: "عنوان اصلی صفحه با تصویر و دو دکمه. اولین چیزی که کاربر می‌بیند.",
    group: "header",
    glyph: "◐",
    fields: [
      { key: "eyebrow", label: "عنوان کوچک بالا", type: "text", placeholder: "ارسال سریع به سراسر ایران" },
      { key: "title", label: "عنوان اصلی", type: "text", placeholder: "زیرپوش، ساده و مطمئن" },
      { key: "subtitle", label: "زیرعنوان", type: "textarea" },
      {
        key: "imageUrl",
        label: "عکس قاب هیرو",
        type: "image",
        help: "از «انتخاب از رسانه» عکس را بگذار. خالی بماند؟ قاب با نشان برند پر می‌شود — نه با جای خالی.",
      },
      {
        key: "imageAlt",
        label: "متن جایگزین عکس",
        type: "text",
        placeholder: "مثلاً: ست سوتین و شورت نخی — رنگ صورتی",
        help: "برای خوانندهٔ صفحه و موتور جست‌وجو؛ اگر عکس فقط تزئینی است خالی بگذارید.",
      },
      {
        key: "imageFocus",
        label: "کادر عکس",
        type: "select",
        options: [
          { value: "center", label: "وسط" },
          { value: "top", label: "بالا" },
          { value: "bottom", label: "پایین" },
        ],
        help: "برای عکس عمودی که در قاب بریده می‌شود، بخش مهم تصویر را انتخاب کنید.",
      },
      { key: "height", label: "ارتفاع", type: "select", options: [
        { value: "sm", label: "کوتاه" },
        { value: "md", label: "متوسط" },
        { value: "lg", label: "بلند" },
      ] },
      ...ctaFields,
      { key: "secondaryLabel", label: "متن دکمه دوم", type: "text" },
      linkField("secondaryHref", "لینک دکمه دوم"),
      alignField,
    ],
    defaults: {
      eyebrow: "ارسال سریع و بسته‌بندی محرمانه",
      title: "زیرپوش، ساده و مطمئن",
      subtitle: "سایز درست، اطلاعات شفاف، بدون هیچ ابهامی.",
      height: "md",
      ctaLabel: "مشاهده محصولات",
      ctaHref: "/c/bra",
      secondaryLabel: "راهنمای سایز",
      secondaryHref: "/guides/size",
      align: "start",
      imageFocus: "center",
    },
  },

  BANNER: {
    type: "BANNER",
    label: "بنر تبلیغاتی",
    description: "یک نوار رنگی با عنوان و دکمه — برای کمپین یا معرفی ویژه.",
    group: "header",
    glyph: "▭",
    fields: [
      { key: "title", label: "عنوان", type: "text" },
      { key: "subtitle", label: "زیرعنوان", type: "textarea" },
      { key: "tone", label: "رنگ‌بندی", type: "select", options: [
        { value: "primary", label: "بنفش برند" },
        { value: "dark", label: "تیره" },
        { value: "soft", label: "روشن" },
      ] },
      ...ctaFields,
    ],
    defaults: {
      title: "پیشنهاد ویژه این هفته",
      subtitle: "ارسال رایگان برای خرید بالای مبلغ مشخص",
      tone: "primary",
      ctaLabel: "مشاهده",
      ctaHref: "/c/set",
    },
  },

  CATEGORY_GRID: {
    type: "CATEGORY_GRID",
    label: "شبکه دسته‌بندی‌ها",
    description: "دسته‌های فروشگاه را از داده زنده نمایش می‌دهد.",
    group: "commerce",
    glyph: "▦",
    fields: [
      { key: "title", label: "عنوان بخش", type: "text" },
      { key: "limit", label: "تعداد دسته", type: "number", min: 2, max: 12, step: 1 },
    ],
    defaults: { title: "دسته‌بندی‌ها", limit: 6 },
  },

  ART_SHOWCASE: {
    type: "ART_SHOWCASE",
    label: "نمونه‌کار آرت (قفسهٔ فرم‌ها)",
    description:
      "شش فرم محصول با آرت اختصاصی — پل بین قاب هیرو و کارت محصول تا پیش از رسیدن عکس‌ها.",
    group: "commerce",
    glyph: "◫",
    fields: [
      { key: "eyebrow", label: "عنوان کوچک بالا", type: "text", placeholder: "نمونه‌کار" },
      { key: "title", label: "عنوان", type: "text" },
      { key: "subtitle", label: "زیرعنوان", type: "textarea" },
      { key: "caption", label: "پانویس", type: "text", help: "یک خط کوچک زیر قفسه — مثلاً منبع آرت‌ها." },
      {
        key: "frames",
        label: "قاب‌ها (ترتیب و رنگ)",
        type: "list",
        listRows: 6,
        listFixed: true,
        help:
          "ترتیب را با کشیدن نقطه‌های کنارِ شمارهٔ هر ردیف عوض کن؛ دکمه‌های ↑ و ↓ همان کار را با صفحه‌کلید هم انجام می‌دهند. رنگ هر قاب را از پالت برند انتخاب کن — فرم و شمارهٔ قاب‌ها ثابت برند است.",
        itemFields: [
          {
            key: "kind",
            label: "فرم",
            type: "art",
            colorFrom: "color",
            options: ART_FRAME_KINDS.map((k) => ({ value: k.value, label: k.label })),
          },
          {
            key: "color",
            label: "رنگ",
            type: "swatch",
            options: ART_FRAME_COLORS.map((c) => ({
              value: c.value,
              label: c.label,
              cssVar: c.cssVar,
            })),
          },
          {
            key: "label",
            label: "برچسب",
            type: "text",
            placeholder: "خالی = نام دستهٔ زنده",
          },
          {
            key: "note",
            label: "توضیح کوتاه",
            type: "text",
            maxLength: 80,
            placeholder: ART_FRAME_NOTES.set + " (خالی = متن پیش‌فرض برند)",
          },
          {
            key: "badge",
            label: "نشان گوشه",
            type: "text",
            maxLength: 24,
            placeholder: "خالی = بدون نشان",
          },
        ],
      },
      {
        key: "showBadges",
        label: "نمایش نشان‌های گوشه",
        type: "boolean",
        help:
          "خاموش کردن این کلید نشان‌ها را از همهٔ قاب‌ها برمی‌دارد، ولی متنشان می‌ماند — برای وقتی می‌خواهی قفسه آرام‌تر شود.",
      },
      ...ctaFields,
    ],
    defaults: {
      eyebrow: "نمونه‌کار",
      title: "شش فرم، یک زبان بصری",
      subtitle:
        "از ست روزانه تا گن و لباس خواب؛ هر دسته آرت اختصاصی خودش را دارد تا فرم و کاربردش را پیش از عکس ببینی.",
      caption: "آرت اختصاصی قاصدک · تا رسیدن عکس‌های واقعی",
      frames: ART_FRAME_DEFAULTS.map((f) => ({
        ...f,
        note: ART_FRAME_NOTES[f.kind],
        badge: ART_FRAME_BADGES[f.kind],
      })),
      showBadges: true,
      ctaLabel: "مشاهده همه محصولات",
      ctaHref: "/search",
    },
  },

  BRAND_GRID: {
    type: "BRAND_GRID",
    label: "برندها",
    description: "لوگوی برندهای فروشگاه را از داده زنده نمایش می‌دهد.",
    group: "commerce",
    glyph: "◈",
    fields: [
      { key: "title", label: "عنوان بخش", type: "text" },
      { key: "limit", label: "تعداد برند", type: "number", min: 2, max: 24, step: 1 },
    ],
    defaults: { title: "برندها", limit: 12 },
  },

  PRODUCT_CAROUSEL: {
    type: "PRODUCT_CAROUSEL",
    label: "شلف محصولات (اسکرول افقی)",
    description: "محصولات واقعی فروشگاه در یک ردیف قابل اسکرول.",
    group: "commerce",
    glyph: "≡",
    fields: [
      { key: "title", label: "عنوان بخش", type: "text" },
      { key: "subtitle", label: "زیرعنوان", type: "text" },
      {
        key: "source",
        label: "کدام محصولات",
        type: "select",
        options: [
          { value: "newest", label: "جدیدترین‌ها" },
          { value: "all", label: "همه محصولات" },
          { value: "discounted", label: "تخفیف‌دارها" },
        ],
      },
      { key: "limit", label: "تعداد", type: "number", min: 2, max: 24, step: 1 },
      linkField("ctaHref", "لینک «همه» (اختیاری)"),
      { key: "ctaLabel", label: "متن لینک «همه»", type: "text" },
    ],
    defaults: {
      title: "جدیدترین‌ها",
      source: "newest",
      limit: 8,
      ctaLabel: "همه محصولات",
      ctaHref: "/search",
    },
  },

  PRODUCT_GRID: {
    type: "PRODUCT_GRID",
    label: "شبکه محصولات",
    description: "محصولات واقعی در قالب شبکه‌ای منظم.",
    group: "commerce",
    glyph: "⊞",
    fields: [
      { key: "title", label: "عنوان بخش", type: "text" },
      { key: "subtitle", label: "زیرعنوان", type: "text" },
      {
        key: "source",
        label: "کدام محصولات",
        type: "select",
        options: [
          { value: "newest", label: "جدیدترین‌ها" },
          { value: "all", label: "همه محصولات" },
          { value: "discounted", label: "تخفیف‌دارها" },
        ],
      },
      { key: "limit", label: "تعداد", type: "number", min: 2, max: 24, step: 1 },
      { key: "columns", label: "تعداد ستون", type: "select", options: [
        { value: "2", label: "۲" },
        { value: "3", label: "۳" },
        { value: "4", label: "۴" },
      ] },
    ],
    defaults: { title: "پیشنهاد ما", source: "newest", limit: 8, columns: "4" },
  },

  FEATURE_TRIPLE: {
    type: "FEATURE_TRIPLE",
    label: "سه ویژگی",
    description: "سه کارت کوتاه برای مزیت‌های فروشگاه (ارسال، بسته‌بندی، بازگشت).",
    group: "content",
    glyph: "✦",
    fields: [
      { key: "title", label: "عنوان بخش", type: "text" },
      {
        key: "items",
        label: "موارد",
        type: "list",
        listRows: 3,
        itemFields: [
          { key: "icon", label: "نماد", type: "text" },
          { key: "title", label: "عنوان", type: "text" },
          { key: "text", label: "توضیح", type: "textarea" },
        ],
      },
    ],
    defaults: {
      title: "چرا قاصدک؟",
      items: [
        { icon: "🚚", title: "ارسال سریع", text: "ارسال به سراسر ایران با بسته‌بندی امن." },
        { icon: "🔒", title: "بسته‌بندی محرمانه", text: "بدون نام و نشانه روی بسته." },
        { icon: "↩️", title: "بازگشت آسان", text: "مهلت ۷ روزه طبق شرایط فروشگاه." },
      ],
    },
  },

  IMAGE_TEXT: {
    type: "IMAGE_TEXT",
    label: "عکس + متن",
    description: "یک تصویر در کنار متن و دکمه.",
    group: "content",
    glyph: "◨",
    fields: [
      { key: "imageUrl", label: "تصویر", type: "image" },
      { key: "title", label: "عنوان", type: "text" },
      { key: "text", label: "متن", type: "textarea" },
      ...ctaFields,
      { key: "imageSide", label: "جای تصویر", type: "select", options: [
        { value: "start", label: "راست" },
        { value: "end", label: "چپ" },
      ] },
    ],
    defaults: {
      title: "راهنمای سایز دقیق",
      text: "برای هر محصول جدول سایز واقعی نوشته شده تا انتخاب مطمئن‌تری داشته باشید.",
      ctaLabel: "راهنمای سایز",
      ctaHref: "/guides/size",
      imageSide: "start",
    },
  },

  RICH_TEXT: {
    type: "RICH_TEXT",
    label: "متن ساده",
    description: "یک بلوک متنی با عنوان — برای توضیح یا شرایط.",
    group: "content",
    glyph: "¶",
    fields: [
      { key: "title", label: "عنوان", type: "text" },
      { key: "text", label: "متن", type: "textarea" },
      alignField,
    ],
    defaults: { title: "", text: "", align: "start" },
  },

  STATS: {
    type: "STATS",
    label: "آمار و اعداد",
    description: "نمایش چند عدد اعتمادساز (سفارش، مشتری، رضایت).",
    group: "social",
    glyph: "#",
    fields: [
      { key: "title", label: "عنوان", type: "text" },
      {
        key: "items",
        label: "اعداد",
        type: "list",
        listRows: 3,
        itemFields: [
          { key: "value", label: "عدد", type: "text" },
          { key: "label", label: "برچسب", type: "text" },
        ],
      },
    ],
    defaults: {
      title: "اعتماد مشتریان",
      items: [
        { value: "+۱۲٬۰۰۰", label: "سفارش موفق" },
        { value: "۴٫۹", label: "رضایت مشتری" },
        { value: "۲۴", label: "ساعت پاسخ‌گویی" },
      ],
    },
  },

  FAQ: {
    type: "FAQ",
    label: "سوالات متداول",
    description: "آکاردئون پرسش و پاسخ — مناسب صفحات راهنما.",
    group: "content",
    glyph: "?",
    fields: [
      { key: "title", label: "عنوان", type: "text" },
      {
        key: "items",
        label: "پرسش‌ها",
        type: "list",
        listRows: 4,
        itemFields: [
          { key: "q", label: "پرسش", type: "text" },
          { key: "a", label: "پاسخ", type: "textarea" },
        ],
      },
    ],
    defaults: {
      title: "سوالات متداول",
      items: [
        { q: "چطور سایز درست را انتخاب کنم؟", a: "در صفحه هر محصول جدول سایز وجود دارد؛ راهنمای کامل در /guides/size است." },
        { q: "امکان مرجوعی وجود دارد؟", a: "بله، تا ۷ روز، مشروط به اینکه کالا پوشیده نشده باشد." },
      ],
    },
  },

  TESTIMONIALS: {
    type: "TESTIMONIALS",
    label: "نظر مشتریان",
    description: "چند نظر مشتری برای اعتمادسازی.",
    group: "social",
    glyph: "❝",
    fields: [
      { key: "title", label: "عنوان", type: "text" },
      {
        key: "items",
        label: "نظرات",
        type: "list",
        listRows: 3,
        itemFields: [
          { key: "name", label: "نام", type: "text" },
          { key: "text", label: "متن نظر", type: "textarea" },
        ],
      },
    ],
    defaults: {
      title: "نظر مشتریان",
      items: [
        { name: "زهرا", text: "بسته‌بندی خیلی مرتب و بی‌نام بود. سایزم درست اومد." },
        { name: "مریم", text: "ارسال سریع بود و خیلی راضی‌ام." },
      ],
    },
  },

  TRUST_BAR: {
    type: "TRUST_BAR",
    label: "نوار اعتماد",
    description: "نوار باریک با چند تضمین کوتاه.",
    group: "social",
    glyph: "✓",
    fields: [
      {
        key: "items",
        label: "موارد",
        type: "list",
        listRows: 4,
        itemFields: [{ key: "text", label: "متن", type: "text" }],
      },
    ],
    defaults: {
      items: [
        { text: "ارسال سریع" },
        { text: "بسته‌بندی محرمانه" },
        { text: "۷ روز مهلت بازگشت" },
        { text: "ضمانت اصالت" },
      ],
    },
  },

  NEWSLETTER: {
    type: "NEWSLETTER",
    label: "خبرنامه",
    description: "باور دوشیده با عنوان و توضیح (اتصال به سرویس پیامک در فاز بعد).",
    group: "social",
    glyph: "✉",
    fields: [
      { key: "title", label: "عنوان", type: "text" },
      { key: "subtitle", label: "توضیح", type: "textarea" },
    ],
    defaults: {
      title: "خبرنامه قاصدک",
      subtitle: "اول از تخفیف‌ها باخبر شو.",
    },
  },

  SPACER: {
    type: "SPACER",
    label: "فاصله‌گذار",
    description: "فقط برای ایجاد فضای خالی بین دو بلوک.",
    group: "layout",
    glyph: "↕",
    fields: [
      { key: "size", label: "اندازه", type: "select", options: [
        { value: "sm", label: "کم" },
        { value: "md", label: "متوسط" },
        { value: "lg", label: "زیاد" },
      ] },
    ],
    defaults: { size: "md" },
  },
};

export const CMS_BLOCK_GROUPS: Array<{ id: CmsBlockGroup; label: string }> = [
  { id: "header", label: "هدر و بنر" },
  { id: "commerce", label: "فروشگاه" },
  { id: "content", label: "محتوا" },
  { id: "social", label: "اعتمادسازی" },
  { id: "layout", label: "چیدمان" },
];

/* ─────────────────────────── اعتبارسنجی ─────────────────────────── */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** طول امن برای رشته‌ها — جلوگیری از اسکیمای غول‌پیکر */
function safeStr(v: unknown, max = 2000): string {
  if (typeof v !== "string") return "";
  return v.length > max ? v.slice(0, max) : v;
}

/**
 * پاکسازی مقدار لینک/آدرس تصویر.
 *
 * `javascript:` و طرح‌واره‌های مشابه اصلاً ذخیره نمی‌شوند. React هم
 * مسدودشان می‌کند، اما اینجا دفاع اول است: دیتابیس نباید ورودی ناامن نگه دارد.
 */
function safeUrl(v: unknown): string {
  const s = safeStr(v, 500).trim();
  if (!s) return "";
  const lower = s.toLowerCase().replace(/[\u0000-\u0020]/g, "");
  if (lower.startsWith("javascript:") || lower.startsWith("vbscript:") || lower.startsWith("file:")) return "";
  // data: فقط برای تصویر درون‌خطی مجاز است، نه برای اسکریپت
  if (lower.startsWith("data:") && !lower.startsWith("data:image/")) return "";
  return s;
}

function safeList(v: unknown, maxRows = 12): unknown[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, maxRows);
}

/** کپی تازه از مقدار پیش‌فرضِ یک لیست — تا دو بلوک یک آرایه را share نکنند */
function cloneList(v: unknown): unknown[] {
  return Array.isArray(v) ? v.map((row) => (isPlainObject(row) ? { ...row } : row)) : [];
}

/**
 * نرمال‌سازی props یک بلوک — فقط کلیدهای مجازِ همان تعریف عبور می‌کنند.
 * این لایهٔ امنیتی است: HTML/اسکریپت خام هرگز از این مسیر عبور نمی‌کند
 * چون هیچ فیلدی نوع "html" ندارد.
 */
export function sanitizeBlockProps(type: CmsBlockType, input: unknown): Record<string, unknown> {
  const def = CMS_BLOCK_DEFS[type];
  const out: Record<string, unknown> = {};
  if (!def || !isPlainObject(input)) return { ...def.defaults };
  for (const field of def.fields) {
    const raw = input[field.key];
    if (raw === undefined) {
      out[field.key] = field.type === "list" ? cloneList(def.defaults[field.key]) : def.defaults[field.key];
      continue;
    }
    switch (field.type) {
      case "number": {
        const n = Number(raw);
        const min = field.min ?? Number.NEGATIVE_INFINITY;
        const max = field.max ?? Number.POSITIVE_INFINITY;
        out[field.key] = Number.isFinite(n) ? Math.min(Math.max(n, min), max) : (def.defaults[field.key] as number);
        break;
      }
      case "boolean":
        out[field.key] = Boolean(raw);
        break;
      case "list": {
        const rows = safeList(raw, field.listRows ?? 12).filter(isPlainObject);
        const itemFields = field.itemFields ?? [];
        out[field.key] = rows.map((row) => {
          const clean: Record<string, unknown> = {};
          for (const f of itemFields) {
            const v = row[f.key];
            if (f.type === "swatch" || f.type === "art") {
              // ستونِ انتخابی (رنگ قاب، فرم قاب) فقط مقدارِ مجاز را نگه می‌دارد —
              // رنگ یا شکلِ دلخواه از این مسیر رد نمی‌شود.
              const s = typeof v === "string" ? v : "";
              clean[f.key] = (f.options ?? []).some((o) => o.value === s) ? s : "";
            } else {
              // سقفِ طول برای ستون‌هایی که معنایشان کوتاه است (توضیح/نشانِ قاب)
              clean[f.key] = typeof v === "number" ? v : safeStr(v, f.maxLength ?? 800);
            }
          }
          return clean;
        });
        break;
      }
      case "select": {
        const s = safeStr(raw, 80);
        const ok = (field.options ?? []).some((o) => o.value === s);
        out[field.key] = ok ? s : (def.defaults[field.key] as string);
        break;
      }
      case "link":
      case "image":
        out[field.key] = safeUrl(raw);
        break;
      default:
        out[field.key] = safeStr(raw);
    }
  }
  return out;
}

/** شناسهٔ کوتاه و پایدار برای بلوک */
export function newBlockId(): string {
  return `b_${Math.random().toString(36).slice(2, 9)}`;
}

/** ساخت بلوک جدید با مقادیر پیش‌فرض تعریف‌شده */
export function makeBlock(type: CmsBlockType): CmsBlock {
  const def = CMS_BLOCK_DEFS[type];
  const props: Record<string, unknown> = {};
  for (const f of def.fields) {
    props[f.key] = f.type === "list" ? JSON.parse(JSON.stringify(def.defaults[f.key] ?? [])) : def.defaults[f.key];
  }
  return { id: newBlockId(), type, props };
}

/** نرمال‌سازی کل صفحه — ورودی ناشناخته را به شکل معتبر درمی‌آورد */
export function normalizeCmsPage(input: unknown): CmsPageData {
  const src = isPlainObject(input) ? input : {};
  const rawBlocks = Array.isArray(src.blocks) ? src.blocks : [];
  const seen = new Set<string>();
  const blocks: CmsBlock[] = [];
  for (const raw of rawBlocks.slice(0, 80)) {
    if (!isPlainObject(raw)) continue;
    const type = raw.type as CmsBlockType;
    if (!CMS_BLOCK_TYPES.includes(type)) continue;
    // شناسه باید بین ذخیره‌ها ثابت بماند وگرنه انتخاب بلوک در بوم می‌پرد
    const given = typeof raw.id === "string" ? raw.id.trim().slice(0, 40) : "";
    let id = given || newBlockId();
    if (seen.has(id)) id = newBlockId();
    seen.add(id);
    blocks.push({
      id,
      type,
      props: sanitizeBlockProps(type, raw.props),
      hidden: raw.hidden === true ? true : undefined,
    });
  }
  const seo = isPlainObject(src.seo) ? src.seo : undefined;
  return {
    version: 1,
    title: safeStr(src.title, 200) || "بدون عنوان",
    seo: seo
      ? {
          title: safeStr(seo.title, 200) || undefined,
          description: safeStr(seo.description, 500) || undefined,
          ogImage: safeStr(seo.ogImage, 500) || undefined,
          noIndex: seo.noIndex === true ? true : undefined,
        }
      : undefined,
    blocks,
  };
}

/** یک صفحهٔ خالی برای شروع کار */
export function emptyCmsPage(title = "صفحهٔ جدید"): CmsPageData {
  return { version: 1, title, blocks: [] };
}

/** صفحاتی که صفحه‌ساز به‌صورت پیش‌فرض پیشنهاد می‌کند */
export const CMS_SUGGESTED_PAGES: Array<{ slug: string; title: string; route: string }> = [
  { slug: "home", title: "صفحه اصلی", route: "/" },
  { slug: "about", title: "درباره ما", route: "/about" },
  { slug: "returns", title: "شرایط بازگشت کالا", route: "/returns" },
  { slug: "shipping", title: "روش‌های ارسال", route: "/shipping" },
  { slug: "contact", title: "تماس با ما", route: "/contact" },
];
