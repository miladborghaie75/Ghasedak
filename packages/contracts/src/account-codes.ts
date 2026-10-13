/**
 * کدهای حساب — **منبع یکتای حقیقت**.
 *
 * چرا این فایل وجود دارد:
 *  این کدها قبلاً در ۱۳ جای مختلف `apps/api/src` پخش بود — بعضی به‌صورت
 *  رشتهٔ `"1200"` داخل سند، بعضی به‌صورت ثابت `GL_BANK` در سرویس خزانه و
 *  بعضی به‌صورت `const GL_AP` در سرویس چک. نتیجه: تغییر یک کد یا افزودن
 *  زیرحساب یعنی ویرایش ده‌ها جای، و هیچ راهی برای دیدن کلِ کدینگ از یک‌جا
 *  وجود ندارد. یک اشتباه تایپی در یک سند، خطای زمان اجرا می‌داد نه خطای کامپایل.
 *
 * فاز ۰٫۳ این فایل را گسترش می‌دهد به کدینگ کامل ایرانی؛ الان لایهٔ پایهٔ
 * همان ۱۲ حسابی است که در `seed.ts` ساخته می‌شوند — یعنی هر کدی که
 * امروز در دیتابیس هست و اسناد موجود به آن اشاره دارند.
 */

/** دارایی‌ها */
export const GL = {
  /** موجودی نقد (صندوق) */
  CASH: "1000",
  /** حساب‌های بانکی */
  BANK: "1100",
  /** موجودی کالا و مواد اولیه */
  INVENTORY: "1200",
  /** حساب‌های دریافتنی تجاری (بدهی مشتری) */
  RECEIVABLE_TRADE: "1210",
  /** چک‌های دریافتی */
  CHECK_RECEIVABLE: "1220",
  /**
   * کالای در راه انتقال بین انبارها (گام ۴ فاز ۲).
   *
   * داراییی است: کالا از انبار مبدأ خارج شده ولی به مقصد نرسیده. بدون این
   * حساب، جابه‌جایی بین شعب ارزش موجودی را از ترازنامه حذف می‌کرد.
   */
  /** کالای در راه انتقال بین انبارها (گام ۴ فاز ۲). */
  GOODS_IN_TRANSIT: "1230",
  /**
   * طلب از درگاه پرداخت (فاز ۲٫۵).
   *
   * داراییی است: پول نزد درگاه هنوز مال ماست (طلب) ولی هنوز به حساب بانک
   * ما نیامده. اگر درگاه نقدی باشد این حساب اصلاً استفاده نمی‌شود؛ اگر
   * اعتباری باشد، فروش اول به این حساب می‌رود و بعد از تسویه به بانک منتقل
   * می‌شود. بدون این حساب، موجودی بانک بیش از واقعیت نشان داده می‌شد.
   */
  GATEWAY_RECEIVABLE: "1250",
} as const;

/** بدهی‌ها */
export const GL_LIABILITIES = {
  /** حساب‌های پرداختنی (بدهی به تامین‌کننده) */
  PAYABLE: "2100",
  /** چک‌های پرداختی در جریان وصول */
  CHECK_PAYABLE_OUTSTANDING: "2110",
  /** کالای دریافتی صورت‌حساب‌نشده */
  GOODS_RECEIVED_NOT_INVOICED: "2150",
} as const;

/** سرمایه */
export const GL_EQUITY = {
  CAPITAL: "3000",
  /** سود و زیان انباشته / سود و زیان دوره — سند اختتامیه اینجا می‌نشیند */
  RETAINED_EARNINGS: "3900",
} as const;

/** درآمدها */
export const GL_REVENUE = {
  SALES: "4000",
  /**
   * زیرحساب‌های تفکیکی فروش (گام ۲ فاز ۲).
   *
   * چرا لازم است: قبلاً تخفیف و هزینهٔ ارسال هر دو داخل `4000` می‌رفتند، پس
   * از دفتر نمی‌شد فهمید «چقدر واقعاً فروختیم» و «چقدر تخفیف دادیم». با این
   * تفکیک، گزارش سودآوری واقعی (فاز ۵) معنا پیدا می‌کند.
   */
  SALES_RETURN: "4000-01", // برگشت از فروش و تخفیف — بدهکار (کاهش درآمد)
  SHIPPING: "4000-02", // درآمد ارسال — بستانکار
  OTHER: "4000-03", // درآمد متفرقه
} as const;

/** بهای تمام‌شده */
export const GL_COGS = {
  COGS: "5000",
} as const;

/** هزینه‌ها */
export const GL_EXPENSE = {
  OPERATING: "6000",
  /** زیرحساب‌های تفکیکی هزینه (گام ۳ فاز ۲) — برای تحلیل هزینهٔ واقعی */
  SHIPPING_COST: "6000-01", // هزینهٔ ارسال بار (آنچه واقعاً به پست پرداخت شد)
  PACKAGING: "6000-02", // بسته‌بندی
  GATEWAY_FEE: "6000-03", // کارمزد درگاه پرداخت
  SALARY: "6000-04", // حقوق و دستمزد
  RENT: "6000-05", // اجاره و شارژ
  MARKETING: "6000-06", // تبلیغات
  UTILITIES: "6000-07", // اینترنت، برق و آب
  BANK_FEE: "6000-08", // کارمزد بانکی
  GENERAL: "6000-09", // عمومی و متفرقه
} as const;

/** نگاشت نام کلیدی هزینه → حساب زیرحساب (برای سندهای خودکار) */
export const EXPENSE_BY_KIND: Record<
  "shipping" | "packaging" | "gatewayFee" | "salary" | "rent" | "marketing" | "utilities" | "bankFee" | "general",
  string
> = {
  shipping: GL_EXPENSE.SHIPPING_COST,
  packaging: GL_EXPENSE.PACKAGING,
  gatewayFee: GL_EXPENSE.GATEWAY_FEE,
  salary: GL_EXPENSE.SALARY,
  rent: GL_EXPENSE.RENT,
  marketing: GL_EXPENSE.MARKETING,
  utilities: GL_EXPENSE.UTILITIES,
  bankFee: GL_EXPENSE.BANK_FEE,
  general: GL_EXPENSE.GENERAL,
};

/**
 * هر کد به‌همراه نام و نوعش — برای seed، اعتبارسنجی و گزارش.
 * این جدول مرجع نمایش و اعتبارسنجی است؛ `seed.ts` از همین می‌خواند تا
 * نام حساب‌ها در یک جا تعریف شوند.
 */
export const CHART_OF_ACCOUNTS: Array<{ code: string; name: string; type: string }> = [
  { code: GL.CASH, name: "موجودی نقد", type: "ASSET" },
  { code: GL.BANK, name: "بانک", type: "ASSET" },
  { code: GL.INVENTORY, name: "موجودی کالا", type: "ASSET" },
  { code: GL.RECEIVABLE_TRADE, name: "حساب‌های دریافتنی تجاری", type: "ASSET" },
  { code: GL.CHECK_RECEIVABLE, name: "چک‌های دریافتی", type: "ASSET" },
  { code: GL.GOODS_IN_TRANSIT, name: "کالای در راه انتقال", type: "ASSET" },
  { code: GL.GATEWAY_RECEIVABLE, name: "طلب از درگاه پرداخت (تسویه‌نشده)", type: "ASSET" },
  { code: GL_LIABILITIES.PAYABLE, name: "حساب‌های پرداختنی", type: "LIABILITY" },
  {
    code: GL_LIABILITIES.CHECK_PAYABLE_OUTSTANDING,
    name: "چک‌های پرداختنی در جریان وصول",
    type: "LIABILITY",
  },
  {
    code: GL_LIABILITIES.GOODS_RECEIVED_NOT_INVOICED,
    name: "کالای دریافتی صورت‌حساب‌نشده (GRNI)",
    type: "LIABILITY",
  },
  { code: GL_EQUITY.CAPITAL, name: "سرمایه", type: "EQUITY" },
  { code: GL_EQUITY.RETAINED_EARNINGS, name: "سود و زیان انباشته", type: "EQUITY" },
  { code: GL_REVENUE.SALES, name: "فروش", type: "REVENUE" },
  { code: GL_COGS.COGS, name: "بهای تمام‌شده کالای فروش‌رفته", type: "COGS" },
  { code: GL_EXPENSE.OPERATING, name: "هزینه‌های عملیاتی", type: "EXPENSE" },
];

/**
 * ─────────────────────────────────────────────────────────────
 * کدینگ استاندارد بازرگانی (فاز ۰٫۳)
 *
 * ساختار درختی: `level` ۱ گروه اصلی، `level` ۲ زیرحساب عملیاتی.
 * حساب‌های `level 1` دقیقاً همان ۱۲ حساب قبلی‌اند، پس **اسناد موجود
 * بی‌معنا نمی‌شوند** — فقط زیرحساب به آن‌ها اضافه می‌گردد.
 *
 * چرا این تفکیک لازم است: قبلاً ضایعات انبار، کسری انبارگردانی، حقوق،
 * کارمزد درگاه و هزینهٔ نقدی **همه در `6000` می‌ریختند**. یعنی دفتر
 * متوازن بود ولی هیچ‌وقت نمی‌شد فهمید پول کجا رفته. با زیرحساب‌ها،
 * هر نوع هزینه مانده و روند خودش را دارد.
 *
 * نحوهٔ کدگذاری: کد زیرحساب = کد گروه + `-` + شمارهٔ دو رقمی.
 * مثال: `6000-01` = هزینهٔ ارسال زیرمجموعهٔ `6000`.
 *
 * این کدها به‌صورت **پیشنهاد** ساخته می‌شوند و با UI قابل تغییرند؛
 * سرویس‌ها فقط به کدهای ثابت گروه اصلی ارجاع می‌دهند (که تغییر نمی‌کنند).
 * ─────────────────────────────────────────────────────────────
 */

/**
 * زیرحساب‌های عملیاتی که سرویس‌ها در فاز ۲ به آن‌ها سند می‌زنند.
 *
 * تا وقتی سرویس‌ها به این‌ها سوییچ نشوند، سندها روی حساب گروه اصلی
 * می‌نشینند (که درست و متوازن است) — یعنی مهاجرت به‌خودی‌خود رفتار
 * مالی را عوض نمی‌کند و فقط ساختار تحلیلی می‌سازد.
 */
export const SUB_ACCOUNTS: Array<{
  code: string;
  name: string;
  parent: string;
  type: string;
  /** زیرحساب پیش‌فرضِ هر گروه — برای اسنادی که هنوز تفکیک نشده‌اند */
  catchAll?: boolean;
}> = [
  // ── درآمد: برگشت و تخفیف باید از فروش جدا باشند ──
  { code: "4000-01", name: "برگشت از فروش (تخفیف و مرجوعی)", parent: "4000", type: "REVENUE" },
  { code: "4000-02", name: "درآمد ارسال", parent: "4000", type: "REVENUE" },
  { code: "4000-03", name: "درآمد متفرقه", parent: "4000", type: "REVENUE", catchAll: true },

  // ── بهای تمام‌شده ──
  { code: "5000-01", name: "زیان ضایعات و انهدام", parent: "5000", type: "COGS" },
  { code: "5000-02", name: "زیان کسری انبارگردانی", parent: "5000", type: "COGS" },
  { code: "5000-03", name: "بهای تمام‌شده فروش", parent: "5000", type: "COGS", catchAll: true },

  // ── هزینه‌ها: تفکیک حیاتی برای تصمیم مدیریتی ──
  { code: "6000-01", name: "هزینهٔ ارسال بار", parent: "6000", type: "EXPENSE" },
  { code: "6000-02", name: "هزینهٔ بسته‌بندی", parent: "6000", type: "EXPENSE" },
  { code: "6000-03", name: "کارمزد درگاه پرداخت", parent: "6000", type: "EXPENSE" },
  { code: "6000-04", name: "حقوق و دستمزد", parent: "6000", type: "EXPENSE" },
  { code: "6000-05", name: "اجاره و شارژ", parent: "6000", type: "EXPENSE" },
  { code: "6000-06", name: "تبلیغات و بازاریابی", parent: "6000", type: "EXPENSE" },
  { code: "6000-07", name: "اینترنت، برق و آب", parent: "6000", type: "EXPENSE" },
  { code: "6000-08", name: "هزینهٔ برداشت و کارمزد بانکی", parent: "6000", type: "EXPENSE" },
  { code: "6000-09", name: "هزینه‌های عمومی و متفرقه", parent: "6000", type: "EXPENSE", catchAll: true },
];

/**
 * کد پیش‌فرضِ هر گروه — جایی که اسناد فعلی (که هنوز تفکیک نشده‌اند)
 * باید بنشینند. با این کار مهاجرت **بدون تغییر رفتار** است.
 */
export const CATCH_ALL_BY_PARENT: Record<string, string> = Object.fromEntries(
  SUB_ACCOUNTS.filter((s) => s.catchAll).map((s) => [s.parent, s.code]),
);

/** همهٔ حساب‌ها — گروه اصلی + زیرحساب — به‌ترتیب کد */
export const FULL_CHART_OF_ACCOUNTS: Array<{
  code: string;
  name: string;
  type: string;
  parent?: string;
  level: number;
}> = [
  ...CHART_OF_ACCOUNTS.map((a) => ({ ...a, level: 1 as const })),
  ...SUB_ACCOUNTS.map((s) => ({ ...s, parent: s.parent, level: 2 as const })),
].sort((a, b) => a.code.localeCompare(b.code));

/**
 * بررسی می‌کند کد زیرحساب به والدِ موجود اشاره می‌کند.
 * در مهاجرت استفاده می‌شود تا اگر والدی نبود، ساخته شود.
 */
export function parentCodeOf(subCode: string): string | null {
  const i = subCode.lastIndexOf("-");
  return i > 0 ? subCode.slice(0, i) : null;
}

/* ═══════════════ توابع کمکی (بعد از تعریف داده‌ها) ═══════════════ */

/**
 * نوع هر حساب بر پایهٔ کد — برای ساخت سند اختتامیه لازم است.
 * «حساب موقت» یعنی درآمد/هزینه که در پایان سال باید بسته شود.
 *
 * زیرحساب‌ها هم در این جدول‌اند تا `isTemporaryAccount("6000-01")` درست
 * جواب بدهد — وگرنه سند اختتامیه زیرحساب‌های هزینه را نمی‌بست و پایان
 * سال نامتوازن می‌شد.
 */
const TYPE_BY_CODE = new Map(FULL_CHART_OF_ACCOUNTS.map((a) => [a.code, a.type]));

export function accountType(code: string): string | undefined {
  return TYPE_BY_CODE.get(code);
}

/** آیا این حساب موقت است (در پایان سال بسته می‌شود)؟ */
export function isTemporaryAccount(code: string): boolean {
  const t = accountType(code);
  return t === "REVENUE" || t === "COGS" || t === "EXPENSE";
}

/**
 * همهٔ کدهای حساب موقت در سطح گروه — برای سند اختتامیه.
 *
 * فقط `level 1` برگردانده می‌شود چون سند اختتامیه روی **گروه‌ها** بسته
 * می‌شود نه روی تک‌تک زیرحساب‌ها؛ وگرنه ماندهٔ گروه دوبار بسته می‌شد.
 */
export function temporaryGroupCodes(): string[] {
  return CHART_OF_ACCOUNTS.filter((a) => isTemporaryAccount(a.code)).map((a) => a.code);
}

/** درصد کارمزد درگاه → مبلغ، بر پایهٔ واحد (basis point: ۱۰۰ = ۱٪) */
export function gatewayFeeAmount(
  amount: number,
  feePercentBps: number | null | undefined,
  feeFlatToman: number | bigint | null | undefined,
): number {
  const pct = Number(feePercentBps ?? 0);
  const flat = Number(feeFlatToman ?? 0);
  if (!Number.isFinite(pct) || !Number.isFinite(flat)) return 0;
  const fromPct = pct > 0 ? Math.floor((amount * pct) / 10_000) : 0;
  return Math.max(0, fromPct + Math.max(0, flat));
}

/** همهٔ کدهای شناخته‌شده — برای اعتبارسنجی ورودی سند */
export const KNOWN_ACCOUNT_CODES = FULL_CHART_OF_ACCOUNTS.map((a) => a.code);