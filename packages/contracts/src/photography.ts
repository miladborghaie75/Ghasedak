/**
 * برنامهٔ عکاسی محصول — مشخصاتِ عکسِ هر دسته، وضعیتِ پیشرفت و جایگزینیِ آرت.
 *
 * چرا یک قراردادِ جدا؟ چون سه چیز باید یک حقیقت باشند، وگرنه بعد از چند تغییر
 * از هم می‌افتند:
 *  ۱) عکاس و مدیر باید یک شات‌لیستِ یکسان ببینند — «نمای صافِ جلو» یعنی چه؟
 *  ۲) پنل باید بداند برای هر دسته کدام کادرها اجباری‌اند و کدام‌ها اختیاری.
 *  ۳) فروشگاه باید بداند کِی آرت با عکسِ واقعی جایگزین شده و کِی هنوز آرت است.
 *
 * این فایل عمداً «بدون React» و بدون وابستگی است تا هم پنل ادمین و هم سرویسِ
 * داده و هم فروشگاه بتوانند از یک منبع بخوانند (همان قاعدهٔ قراردادِ بلوک‌های
 * صفحه‌ساز).
 *
 * قانونِ برند (بند ۵): هیچ عکسِ مدل زن. سبک: flat-lay روی سطح روشن. دست و بندِ
 * تن در کادر مجاز نیست — کالا باید «همان چیزی که می‌رسد» را نشان دهد.
 */

/* ─────────────────────────── کادرها (شات‌لیست) ─────────────────────────── */

/** انواعِ کادرِ استانداردِ عکاسی — همین‌ها در شات‌لیستِ برند می‌آیند */
export const PHOTO_SHOT_KINDS = [
  "FLAT_FRONT",
  "FLAT_BACK",
  "COLORS",
  "FABRIC",
  "FORM",
] as const;

export type PhotoShotKind = (typeof PHOTO_SHOT_KINDS)[number];

/**
 * کادرِ اصلی — عکسی که رویِ کارتِ محصول و صفحهٔ محصول می‌نشیند.
 *
 * چرا این یکی جدا است: وقتی «تأیید» می‌شود، همین عکس خودکار عکسِ اصلیِ
 * محصول می‌شود و آرتِ جانشین کنار می‌رود. بقیهٔ کادرها عکسِ گالری‌اند.
 */
export const PRIMARY_PHOTO_SHOT: PhotoShotKind = "FLAT_FRONT";

export interface PhotoShotDef {
  kind: PhotoShotKind;
  /** نامِ کادر به فارسی — چیزی که عکاس می‌خواند */
  label: string;
  /** مشخصاتِ فنیِ همان کادر (قاب، نور، چیزی که در عکس دیده شود) */
  spec: string;
  /** پیش‌فرضِ اجباری/اختیاری — هر دسته می‌تواند آن را تغییر دهد */
  required: boolean;
}

export const PHOTO_SHOTS: PhotoShotDef[] = [
  {
    kind: "FLAT_FRONT",
    label: "نمای صافِ جلو",
    spec: "کالا صاف و کامل در کادر، برچسبِ سایز خوانا، بدون تاشدگی. همین عکس، عکسِ اصلیِ محصول است.",
    required: true,
  },
  {
    kind: "FLAT_BACK",
    label: "نمای صافِ پشت",
    spec: "دوخت و بندِ پشت کامل دیده شود؛ همان نور و همان فاصلهٔ نمای صافِ جلو.",
    required: true,
  },
  {
    kind: "COLORS",
    label: "نمای رنگ‌ها",
    spec: "همهٔ رنگ‌های آن محصول کنار هم، هر کدام جدا و با برچسبِ رنگ. اگر محصول تک‌رنگ است، لازم نیست.",
    required: true,
  },
  {
    kind: "FABRIC",
    label: "جزئیاتِ پارچه",
    spec: "بافت و کش‌باف از نزدیک، بدون ماکروی افراطی (نویزِ تصویر بد می‌شود).",
    required: false,
  },
  {
    kind: "FORM",
    label: "حالتِ فرم",
    spec: "کالا ایستاده و شکلِ واقعی‌اش دیده شود — فقط برای گن و ست لازم است.",
    required: false,
  },
];

/** آیا این مقدار یکی از کادرهای استاندارد است؟ */
export function isPhotoShotKind(v: unknown): v is PhotoShotKind {
  return typeof v === "string" && (PHOTO_SHOT_KINDS as readonly string[]).includes(v);
}

/* ─────────────────────── راه‌اندازیِ ثابتِ همهٔ شات‌ها ─────────────────────── */

/**
 * راه‌اندازیِ مشترکِ همهٔ دسته‌ها — عکاس هر محصولی این‌ها را عیناً انجام می‌دهد.
 * جدا بودنش از مشخصاتِ هر دسته عمدی است: این‌ها تغییر نمی‌کنند مگر اینکه خودِ
 * عکاسی عوض شود.
 */
export const PHOTO_SETUP = {
  background: "سفیدِ مات یا #f6f1fc (تنتِ برند)؛ بدون بافت و سایهٔ تند.",
  light: "یک نرم‌افکسِ ۴۵ درجه + رفلکتور؛ بدون فلاشِ مستقیم (پارچهٔ شفاف می‌سوزد).",
  camera: "عمود بر سطح (top-down) برای نمای صاف؛ سه‌رخِ ۳۰ درجه فقط برای ست‌ها.",
  output: "JPG یا WebP، ۱۲۰۰×۱۲۰۰ مربع، کیفیتِ ۸۰ به بالا.",
  naming: "نامِ فایل: p-<slug>.jpg — همین نام در کتابخانهٔ رسانه قابل پیدا کردن است.",
  rule: "هیچ عکسِ مدل زن؛ دست و بندِ تن در کادر مجاز نیست. کالا باید همان چیزی باشد که می‌رسد.",
} as const;

export interface PhotoCategorySpec {
  /** slugِ دسته — هم‌نام با شکلِ آرت (bra, set, shapewear, …) */
  slug: string;
  /** نامِ فارسیِ دسته */
  label: string;
  /** کادرهای این دسته و اجباری/اختیاری بودنشان */
  shots: Array<{ kind: PhotoShotKind; required: boolean }>;
  /** نکته‌های خاصِ همین دسته (چیزی که عکاسِ همان دسته باید بداند) */
  notes: string[];
  /** اولویتِ عکاسی — عددِ کوچک‌تر زودتر */
  priority: number;
}

/**
 * مشخصاتِ عکسِ هر دسته.
 *
 * ترتیبِ اولویت از سندِ عکاسی برند می‌آید: سوتین‌های پرفروش اول، بعد ست‌ها،
 * بعد گن، بعد شورت و لباسِ خواب/ورزشی.
 */
export const PHOTO_CATEGORY_SPECS: PhotoCategorySpec[] = [
  {
    slug: "bra",
    label: "سوتین",
    priority: 1,
    shots: [
      { kind: "FLAT_FRONT", required: true },
      { kind: "FLAT_BACK", required: true },
      { kind: "COLORS", required: true },
      { kind: "FABRIC", required: false },
    ],
    notes: [
      "برچسبِ سایز و کاپ باید خوانا باشد — مشتری همین را از عکس می‌فهمد.",
      "رنگِ عکس باید با نامِ واریانت یکی باشد (شورتِ «سرمه‌ای» با عکسِ صورتی اشتباه است).",
    ],
  },
  {
    slug: "set",
    label: "ستِ لباس زیر",
    priority: 2,
    shots: [
      { kind: "FLAT_FRONT", required: true },
      { kind: "FLAT_BACK", required: true },
      { kind: "FORM", required: true },
      { kind: "COLORS", required: false },
      { kind: "FABRIC", required: false },
    ],
    notes: [
      "ست در یک قاب: تکهٔ بالا و پایین کنار هم، بدون جدا افتادن.",
      "نمای سه‌رخِ ۳۰ درجه برای ست‌ها لازم است (همان استثنای سه‌رخ).",
    ],
  },
  {
    slug: "shapewear",
    label: "گن",
    priority: 3,
    shots: [
      { kind: "FLAT_FRONT", required: true },
      { kind: "FORM", required: true },
      { kind: "FLAT_BACK", required: false },
      { kind: "COLORS", required: false },
      { kind: "FABRIC", required: false },
    ],
    notes: [
      "نمای فرم مهم‌ترین کادرِ گن است — فرمِ واقعیِ بدن باید دیده شود.",
      "کش‌باف و تخت‌شدنِ لبه‌ها را نزدیک نشان بدهید.",
    ],
  },
  {
    slug: "panty",
    label: "شورت",
    priority: 4,
    shots: [
      { kind: "FLAT_FRONT", required: true },
      { kind: "FLAT_BACK", required: false },
      { kind: "COLORS", required: false },
      { kind: "FABRIC", required: false },
    ],
    notes: ["بندِ کناره و دوختِ لبه در نمای صاف دیده شود."],
  },
  {
    slug: "sport",
    label: "ورزشی",
    priority: 5,
    shots: [
      { kind: "FLAT_FRONT", required: true },
      { kind: "FORM", required: false },
      { kind: "FLAT_BACK", required: false },
      { kind: "COLORS", required: false },
      { kind: "FABRIC", required: false },
    ],
    notes: ["بندِ زیرِ پهن و کشی‌بودنِ پارچه در نمای نزدیک معلوم شود."],
  },
  {
    slug: "sleepwear",
    label: "لباسِ خواب",
    priority: 6,
    shots: [
      { kind: "FLAT_FRONT", required: true },
      { kind: "FORM", required: false },
      { kind: "FLAT_BACK", required: false },
      { kind: "COLORS", required: false },
      { kind: "FABRIC", required: false },
    ],
    notes: ["افتادگی و جنسِ پارچه باید معلوم باشد — عکسِ صافِ خالی گمراه‌کننده است."],
  },
];

/**
 * مشخصاتِ یک دسته — اگر دسته‌ای در فهرست نبود، پیش‌فرضِ امن برمی‌گردد
 * (فقط کادرِ اصلی اجباری است) تا برنامهٔ عکاسی هیچ‌وقت خالی و بی‌معنا نشود.
 */
export function photoSpecForCategory(slug: string | null | undefined): PhotoCategorySpec {
  const found = PHOTO_CATEGORY_SPECS.find((s) => s.slug === slug);
  if (found) return found;
  return {
    slug: slug ?? "",
    label: slug ?? "نامشخص",
    shots: [{ kind: PRIMARY_PHOTO_SHOT, required: true }],
    notes: ["این دسته در فهرستِ استاندارد نیست؛ فقط کادرِ اصلی الزامی است."],
    priority: 99,
  };
}

/* ─────────────────────────── وضعیتِ کارها ─────────────────────────── */

export const PHOTO_TASK_STATUSES = ["PENDING", "SHOT", "NEEDS_RETAKE", "APPROVED"] as const;

export type PhotoTaskStatus = (typeof PHOTO_TASK_STATUSES)[number];

/** برچسبِ فارسیِ وضعیت — در پنل و در گزارش‌ها یکی می‌ماند */
export const PHOTO_STATUS_LABELS: Record<PhotoTaskStatus, string> = {
  PENDING: "در انتظارِ عکس",
  SHOT: "عکس گرفته شد",
  NEEDS_RETAKE: "نیاز به عکسِ دوباره",
  APPROVED: "تأیید شده",
};

export function isPhotoTaskStatus(v: unknown): v is PhotoTaskStatus {
  return typeof v === "string" && (PHOTO_TASK_STATUSES as readonly string[]).includes(v);
}

/* ─────────────────────── تأییدِ گروهی ─────────────────────── */

/** سقفِ کارها در یک تأییدِ گروهی — بیشتر از این، خطای روشن برمی‌گردد نه برشِ بی‌صدا */
export const PHOTO_BULK_APPROVE_MAX = 50;

/**
 * نتیجهٔ تأییدِ گروهی — هر کار نتیجهٔ خودش را دارد.
 *
 * چرا «همه یا هیچ» نیست: ممکن است یکی از کارها در این فاصله پاک شده باشد
 * یا عکسش برداشته شده باشد (نهصفحهٔ عکاس همان لحظه عکسِ دوباره زده). اگر
 * کلِ دسته برمی‌گشت، کارهای سالم هم تأیید نمی‌شدند و مدیر باید دوباره
 * تک‌تک می‌زد — یعنی همان کاری که می‌خواستیم حذف شود.
 */
export interface PhotoBulkApproveResult {
  /** چند کار تأیید شد */
  approved: number;
  /** از میان تأییدشده‌ها، چند تا عکسِ اصلیِ محصول شدند (نمای صافِ جلو) */
  live: number;
  /** کارهایی که تأیید نشدند — با متنِ همان خطا */
  failed: Array<{ taskId: string; message: string }>;
}

/* ─────────────────────────── تابلوی برنامه ─────────────────────────── */

/** یک کادر در تابلو — وضعیتِ همان کادر برای همان محصول */
export interface PhotoProgramShot {
  kind: PhotoShotKind;
  label: string;
  /**
   * مشخصاتِ فنیِ کادر اینجا **نمی‌آید** — همان متن برای همهٔ محصولاتِ یک دسته
   * یکی است و یک بار در `PhotoProgramCategory.shots` آمده.
   *
   * چرا این تفکیک؟ تابلو برای کاتالوگِ ۵٬۰۰۰ محصولی ساخته می‌شود؛ تکرارِ متنِ
   * مشخصات برای هر «محصول × کادر» payload را چند برابر می‌کرد بی‌فایده.
   */
  required: boolean;
  status: PhotoTaskStatus;
  /** شناسهٔ رسانهٔ پیوست‌شده — اگر عکسی ثبت شده باشد */
  mediaId: string | null;
  /** نشانیِ عکس برای نمایش */
  mediaUrl: string | null;
  /** یادداشتِ عکاس (مثلاً «نورِ کم بود») */
  note: string | null;
  /** آیا همین عکس، عکسِ اصلیِ زندهٔ محصول در سایت است؟ (یعنی آرت جایگزین شده) */
  live: boolean;
  /** شناسهٔ کار — برای کنش‌های تأیید/عکسِ دوباره */
  taskId: string | null;
}

/** یک محصول در تابلو */
export interface PhotoProgramProduct {
  id: string;
  slug: string;
  name: string;
  /** slugِ دسته */
  category: string;
  categoryLabel: string;
  /** وضعیتِ انتشارِ محصول — عکاسی برای محصولِ پیش‌نویس هم لازم است */
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  /** عکسِ اصلیِ فعلیِ محصول — اگر هست، آرت جایگزین شده */
  primaryImage: string | null;
  shots: PhotoProgramShot[];
  /** چند کادر از چند کادر آماده است */
  done: number;
  total: number;
  /** درصدِ پیشرفتِ همین محصول (۰ تا ۱۰۰) */
  percent: number;
}

/** یک دسته در تابلو — با کارتِ مشخصاتِ عکسش */
export interface PhotoProgramCategory {
  slug: string;
  label: string;
  priority: number;
  notes: string[];
  /** مشخصاتِ کادرهای این دسته (برای کارتِ مشخصات) */
  shots: Array<{ kind: PhotoShotKind; label: string; spec: string; required: boolean }>;
  products: PhotoProgramProduct[];
  done: number;
  total: number;
  percent: number;
}

/** تابلوی کاملِ برنامهٔ عکاسی */
export interface PhotoProgramBoard {
  categories: PhotoProgramCategory[];
  overall: {
    done: number;
    total: number;
    percent: number;
    /** شمارشِ هر وضعیت در کلِ برنامه */
    byStatus: Record<PhotoTaskStatus, number>;
    /** چند محصول هنوز آرتِ جانشین دارند */
    productsWithArt: number;
    productsTotal: number;
  };
}
