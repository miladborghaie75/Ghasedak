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
  "BANNER",
"CATEGORY_GRID",
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

export interface CmsFieldOption {
  value: string;
  label: string;
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
  /** فقط برای یک نوع خاص بلوک نمایش داده شود (مثال: "HERO|BANNER") */
  onlyFor?: CmsBlockType[];
  /** برای list: کلیدهای هر آیتم */
  itemFields?: Array<Pick<CmsField, "key" | "label" | "type" | "placeholder" | "options">>;
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
      { key: "imageUrl", label: "تصویر پس‌زمینه", type: "image" },
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
      out[field.key] = field.type === "list" ? (def.defaults[field.key] ?? []) : def.defaults[field.key];
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
        const allowed = (field.itemFields ?? []).map((f) => f.key);
        out[field.key] = rows.map((row) => {
          const clean: Record<string, unknown> = {};
          for (const k of allowed) {
            const v = row[k];
            clean[k] = typeof v === "number" ? v : safeStr(v, 800);
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