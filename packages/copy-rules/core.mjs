/**
 * هستهٔ مشترک قواعد لحن و کپی — تنها منبع حقیقت برای ممیزی خودکار.
 * این پکیج بین همهٔ اپ‌ها (فروشگاه، پنل ادمین، …) مشترک است؛ هر اپ فقط
 * «مرز لحن» خودش را در copy-rules.mjs محلی تعریف می‌کند.
 *
 * چرا چنین فایلی لازم است؟ لحن در یک اپ چندجزئی بی‌سروصدا واگرا می‌شود: هر جزء
 * تازه با لحن خودش نوشته می‌شود و کسی نمی‌فهمد. بدترین حالتش لحنِ قاطی در یک
 * صفحه است (مثلاً «سایزت را نمی‌دانی؟» بالای «متر را دور سینه بگیرید»).
 *
 * راهنمای کامل: `docs/copy-tone-guide.md`
 * اینجا مرز و قاعده‌ها یک‌بار ماشین‌خوان نوشته شده‌اند تا تست (`copy.test.mjs`)
 * هر رگرسیون لحنی را قبل از مرج بگیرد.
 *
 *
 * قاعده‌ها:
 *   R1 — یکدستی خطاب در هر فایل: هر فایل فقط یک لحن دارد (مرز در `FORMAL_FILES`).
 *   R2 — بدون تعارف «لطفاً»؛ احترام با لحن گرم نشان داده می‌شود.
 *   R3 — بدون «کلیک»؛ فعل همان کار را نام می‌بریم («انتخاب کن»، «بزن»).
 *   R4 — خطا باید راه‌حل بدهد: «[چه شد]؛ [چه کار کن]».
 *   R5 — اصطلاح داخلی/فنی (توکن، CSRF، nonce…) به کاربر نمایش داده نمی‌شود.
 *   R6 — پیام مشترک فقط یک منبع دارد (واگرایی متن در چند فایل ممنوع).
 *   R7 — نگارش معیار در سطح صمیمی: «تو» بدون شکسته‌نویسی (را، نه «رو»).
 *
 * چرا .mjs؟ تا هم تست Node و هم CLI بتوانند مستقیم import کنند، بدون دست‌زدن
 * به tsconfig یا نیاز به type-stripping.
 */

/** @typedef {{line: number, text: string}} CopyPiece */
/** @typedef {"R1"|"R2"|"R3"|"R4"|"R5"|"R6"|"R7"} RuleId */
/** @typedef {{rule: RuleId, file: string, line: number, text: string, detail: string}} CopyViolation */

/** رشتهٔ کاربرپسند فقط اگر حرف فارسی داشته باشد معنا دارد. */
export const PERSIAN = /[\u0600-\u06FF]/;

/**
 * مرز لحن فایل‌محور — هر اپ فهرست فایل‌های رسمی خودش را دارد.
 * دلیل فایل‌محور بودن: لحن قاطی در یک صفحه بدترین حالت است؛ با مرز فایل‌محور،
 * هر فایل یک صدا دارد و تست می‌تواند همین را تضمین کند.
 * @param {string} relPath
 * @param {string[]} formalFiles
 */
export function isFormalFile(relPath, formalFiles = []) {
  return formalFiles.includes(relPath.replace(/\\/g, "/"));
}

/**
 * افعال دوم‌شخص جمعِ بدون پیشوند صرفی — مثل «انتخاب کنید» که فعلش «کنید» است.
 */
export const BARE_PLURAL_VERBS = [
  "کنید", "دارید", "ندارید", "هستید", "باشید", "نباشید", "دهید", "گیرید",
  "شوید", "بینید", "نمایید", "فرمایید", "بفرمایید", "خواهید", "توانید",
];

/**
 * اسم/صفت‌های هم‌پایانِ «ـید» که فعل نیستند — لازم برای پرهیز از مثبت کاذب.
 */
export const ID_END_NOUNS = [
  "خرید", "امید", "جدید", "کلید", "سفید", "سپید", "شدید", "بعید", "پدید",
  "دید", "تولید", "مفید", "بید", "مرید", "پلید", "سعید", "حمید", "وحید",
  "مجید", "شهید", "تایید", "تأیید", "نوید", "فرید", "قید", "صید", "سدید",
  "رشید", "مزید", "تقلید", "تجدید", "تمدید", "تأکید", "تاکید", "باید",
  // «ـدید» که اسم است نه فعل دوم‌شخص («دیدید»): بازدید، پیش‌بازدید، الگو: [آ-ی]{2}دید
  "بازدید", "پیدید",
  // سوم‌شخص مفرد که به «ـید» ختم می‌شود: «می‌آید» و «بگوید» خلاف لحن نیستند.
  "می‌آید", "نمی‌آید", "آید", "بگوید", "می‌گوید", "نمی‌گوید",
];

/**
 * ضمیرهای دوم‌شخص جمع. «تان» عمومی چک نمی‌شود تا «گلستان/استان/داستان»
 * نقض کاذب نشوند؛ فقط ملک‌های رایج فهرست شده‌اند.
 */
export const PLURAL_PRONOUNS = ["شما", "شمایی", "خودتان", "خودِتان", "برایتان"];
const POSSESSIVE_TAAN =
  /(سفارش|نظر|نام|شماره|آدرس|ایمیل|پول|حساب|سبد|کالا|محصول|اطلاعات|داده|خرید|تن|پاسخ|پیام|فاکتور|قیمت|سایز)تان/;

/**
 * نشانه‌های لحن صمیمی — برای بررسی صفحات رسمی (R1 برعکس) و نشت لحن.
 * فقط واژه‌های صمیمیِ صریح؛ «تو» تنها وقتی که واژهٔ مستقل باشد.
 */
export const INFORMAL_WORDS = [
  "تو", "بزن", "بگیر", "ببین", "بنویس", "کن", "بمان", "باش", "هستی", "داری",
  "نداری", "نمیدانی", "میدانی", "میتوانی", "میخواهی", "برایت", "بخواه",
  "بگرد", "بردار", "بپرس", "بشور", "ماساژ",
];

/**
 * مجموعه‌های نرمال‌شده — یک‌بار ساخته می‌شوند تا مقایسهٔ واژه‌ها هزینه نداشته باشد
 * و «می‌کنید/میکنید» یکسان دیده شوند.
 */
const ID_NOUNS = new Set(ID_END_NOUNS.map(normWord));
const BARE_VERBS = new Set(BARE_PLURAL_VERBS.map(normWord));
const INFORMAL_SET = new Set(INFORMAL_WORDS.map(normWord));
const PLURAL_SET = new Set(PLURAL_PRONOUNS.map(normWord));

/**
 * نگارش شکسته/محاوره‌ای که در سطح صمیمی هم پذیرفته نیست (R7) —
 * «صمیمی» یعنی دوم‌شخص مفرد، نه شکستن کلمه. نگارش معیار.
 */
export const BROKEN_WRITING = [
  "نمیدونی", "میدونی", "میخوای", "میتونی", "میذاره", "میذارم", "چقدره",
  "میدیم", "بشن", "میشه", "نمیشه", "بشه", "توی", "برات", "میگه",  "نمیدونم", "رو کشو", "رو ببین", "رو بزن",
];

/**
 * الگوهای R7 با مرز واژه — نه زیررشته. بدون مرز، «همیشه» شامل «میشه» شمرده
 * می‌شود و پیام‌های کاملاً معیار نقض کاذب می‌گیرند؛ با مرز فقط خودِ واژهٔ
 * شکسته (میشه، نمیشه، رو …) علامت می‌خورد.
 */
const WORD_CHAR = "\\u0621-\\u063A\\u0641-\\u064A\\u066E-\\u06D3\\u06F0-\\u06F9A-Za-z0-9";
const BROKEN_RES = BROKEN_WRITING.map((b) => {
  const v = normWord(b).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^${WORD_CHAR}])${v}(?=[^${WORD_CHAR}]|$)`);
});

/**
 * واژه‌های داخلی/فنی که نباید در متن کاربر ظاهر شوند (R5).
 */
export const INTERNAL_JARGON = ["توکن", "CSRF", "csrf", "nonce", "endpoint", "payload", "undefined", "NaN"];

/** نشانه‌های شکست در متن کاربر (R4) — با مرز واژه، نه زیررشته. */
export const FAILURE_MARKERS = [
  /ناموفق/,
  /خطا/,
  /نشد(?![آ-ی])/,
  /در دسترس نیست/,
  /معتبر نیست/,
  /(پیدا|یافت|ثبت|نمایش داده) نشد(?![آ-ی])/,
  /ممکن نشد(?![آ-ی])/,
  /قابل نمایش نیست/,
  /ناقص/,
  /نامعتبر/,
  /منقضی/,
  /قطع شد(?![آ-ی])/,
];

/** فعل‌هایی که «راه‌حل» را به کاربر می‌گویند (R4). */
export const ACTION_VERBS = [
  "کن", "تلاش", "بررسی", "تماس", "بارگذاری", "انتخاب", "وارد", "بنویس", "برگرد",
  "ادامه", "ورود", "شروع", "بزن", "بگیر", "ببین", "بپرس", "بارگیری",
];

/** حداقل طول برای آنکه یک متن «پیام» شمرده شود، نه برچسب وضعیت کوتاه. */
export const MESSAGE_MIN_LENGTH = 40;

/** حذف کامنت‌ها با احترام به نقل‌قول‌ها (کامنت توسعه‌دهنده متن کاربر نیست). */
function stripComments(line) {
  let out = "";
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") {
        out += ch + (line[i + 1] ?? "");
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      out += ch;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && line[i + 1] === "/") break;
    if (ch === "/" && line[i + 1] === "*") {
      const end = line.indexOf("*/", i + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/** پراپ‌های غیرمتنی که رشته‌شان متن کاربر نیست. */
const NON_COPY_ATTR =
  /(className|class|id|href|src|role|key|htmlFor|name|type|autoComplete|inputMode|fill|stroke|viewBox|d|points|transform|rel|target|method|action|lang|dir|data-[a-z-]+|Date|toJSON|process|env\.[A-Z_]+)=(["'])[^"']*\2/g;

/**
 * استخراج متن کاربرپسند از یک فایل منبع.
 *
 * دو منبع متن لازم است: (۱) رشته‌های نقل‌قولی — شامل پراپ‌های متنی؛ (۲) متن JSX
 * بین تگ‌ها. اگر فقط رشته‌ها را ببینیم، تمام `<p>…</p>`ها از ممیزی جا می‌مانند —
 * دقیقاً همان‌جایی که بیشتر متن خطا و حالت خالی می‌نشیند.
 * خطوط `throw new Error` و `console.*` کنار گذاشته می‌شوند: متن کاربر نیستند.
 *
 * @param {string} src
 * @param {string} [relPath] مسیر نسبی — برای گزارش
 * @returns {CopyPiece[]}
 */
export function extractCopy(src, relPath = "") {
  /** @type {CopyPiece[]} */
  const out = [];
  let inBlockComment = false;

  src.split("\n").forEach((raw, i) => {
    let line = raw;

    if (inBlockComment) {
      const end = line.indexOf("*/");
      if (end === -1) return;
      inBlockComment = false;
      line = line.slice(end + 2);
    }
    const open = line.indexOf("/*");
    if (open !== -1) {
      const close = line.indexOf("*/", open + 2);
      if (close === -1) {
        inBlockComment = true;
        line = line.slice(0, open);
      } else {
        line = line.slice(0, open) + line.slice(close + 2);
      }
    }

    line = stripComments(line);
    if (!line.trim()) return;
    if (/\bthrow new Error\(|\bconsole\.(log|error|warn|info)\(/.test(line)) return;

    /** @type {string[]} */
    const pieces = [];
    const withoutAttrs = line.replace(NON_COPY_ATTR, " ");

    const literalRe = /"([^"\\\n]*)"|'([^'\\\n]*)'|`([^`\\]*)`/g;
    let m;
    while ((m = literalRe.exec(withoutAttrs))) {
      const text = m[1] ?? m[2] ?? m[3] ?? "";
      if (PERSIAN.test(text)) pieces.push(text);
    }

    const jsxText = withoutAttrs.replace(literalRe, " ").replace(/<[^>]*>/g, " ").replace(/\{[^{}]*\}/g, " ").trim();
    // خطِ کد، متنِ JSX نیست: اگر بعد از حذف تگ‌ها هنوز نشانهٔ کد ماند (پرانتز،
    // سمی‌کالن، `=>`، `??`، `?.`)، همان خط کد است و متن فارسی‌اش فقط داخل
    // رشته‌های نقل‌قولی است — که بالاتر جداگانه گرفته شده‌اند. بدون این گارد،
    // خطی مثل `setError(r.error?.message ?? "خطا")` کلِ خط «متن کاربر» می‌شود
    // و نقض R4 کاذب می‌سازد.
    const looksLikeCode = /[();]|=>|\?\?|\?\./.test(jsxText);
    if (!looksLikeCode && PERSIAN.test(jsxText) && !/[<>{}=]/.test(jsxText)) pieces.push(jsxText);

    // یک متن می‌تواند هم در رشتهٔ نقل‌قولی و هم در شاخهٔ JSXِ همان خط دیده شود
    // (مثل template literal داخل JSX) — بدون حذف تکرار، یک نقض دوبار شمرده می‌شود.
    const seen = new Set();
    for (const text of pieces) {
      const clean = text.replace(/\s+/g, " ").trim();
      if (!clean || !PERSIAN.test(clean) || seen.has(clean)) continue;
      seen.add(clean);
      out.push({ line: i + 1, text: clean });
    }
  });

  void relPath;
  return out;
}

/**
 * نرمال‌سازی نیم‌فاصله (ZWNJ).
 *
 * چرا لازم است؟ «می‌کنید» و «میکنید» برای چشم فارسی یکی‌اند ولی برای مقایسهٔ
 * رشته دو چیز متفاوت‌اند — بدون این نرمال‌سازی، فعل جمع می‌تواند بی‌صدا از
 * نگهبان فرار کند (همان‌طور که در نسخهٔ اول همین اتفاق افتاد).
 * @param {string} s
 */
export function normWord(s) {
  return s.replace(/\u200c/g, "");
}

/**
 * واژه‌های یک متن (برای بررسی واژه‌به‌واژه). خروجی بدون نیم‌فاصله است.
 *
 * نکتهٔ دوم: بازهٔ \u0600-\u06FF علامت‌های نگارشی فارسی را هم دربر می‌گیرد
 * («؟»، «،»، «؛»)، پس اگر همان بازه را مرز واژه بگیریم «دارید؟» یک واژهٔ
 * ناشناخته می‌شود و از چشم نگهبان می‌افتد. اینجا فقط حروف و ارقام مجازند.
 * @param {string} text
 */
export function words(text) {
  return text
    .split(/[^\u0621-\u063A\u0641-\u064A\u0660-\u0669\u066E-\u06D3\u06F0-\u06F9\u200cA-Za-z0-9]+/)
    .filter(Boolean)
    .map(normWord);
}

/**
 * آیا این واژه فعلِ دوم‌شخص جمع است؟
 *
 * ظرافت مهم: «ـید» در فارسی اسم هم می‌سازد (خرید، جدید، تایید) و سوم‌شخص مفرد هم
 * به همین دو حرف می‌رسد (می‌آید، بگوید). پس تشخیص با استثنای صریح + الگوی ساخت
 * فعل انجام می‌شود، نه با «پایان با ید»:
 *   • پیشوند ب/می/نمی با هستهٔ فعلی: بزنید، می‌کنید، نمی‌روید
 *   • ستون «آ/ا» در پیشوند می → سوم‌شخص است (می‌آید)، نه دوم‌شخص (می‌آیید)
 *   • گذشتهٔ دوم‌شخص: گرفتید، کردید، بودید · ماضی نقلی: کرده‌اید
 */
export function isPluralVerb(word) {
  const w = normWord(word);
  if (ID_NOUNS.has(w)) return false;
  if (BARE_VERBS.has(w)) return true;
  if (/^ب[آ-ی]{2,}ید$/.test(w)) return true; // بزنید، بگیرید، بنویسید
  if (/^ن?می[آ-ی](?:[آ-ی]*[^آا])?ید$/.test(w)) return true; // میکنید، نمیروید (نه: میآید)
  if (/[آ-ی]هاید$/.test(w)) return true; // کرده‌اید، دیده‌اید
  if (/[آ-ی]{2}دید$/.test(w)) return true; // کردید، دیدید، آمدید
  if (/تید$/.test(w)) return true; // گرفتید، کردید
  if (/ودید$/.test(w)) return true; // بودید
  return false;
}

/** آیا متن نشانهٔ لحن رسمی دارد؟ (فعل جمع یا ضمیر جمع) */
export function hasFormalTone(text) {
  const ws = words(text);
  return ws.some(isPluralVerb) || ws.some((w) => PLURAL_SET.has(w)) || POSSESSIVE_TAAN.test(text);
}

/** آیا متن نشانهٔ لحن صمیمی دارد؟ */
export function hasInformalTone(text) {
  return words(text).some((w) => INFORMAL_SET.has(w));
}

/**
 * نقض قاعده‌ها در یک متن کاربرپسند.
 * @param {string} text
 * @param {{formal?: boolean}} [opts] `formal` = فایل در فهرست صفحات حقوقی است
 * @returns {RuleId[]}
 */
export function checkCopy(text, opts = {}) {
  /** @type {RuleId[]} */
  const rules = [];
  const formal = opts.formal === true;

  // R1 — یکدستی خطاب در همان فایل: مرز، نه سلیقه
  if (formal ? hasInformalTone(text) : hasFormalTone(text)) rules.push("R1");

  // R2 — تعارف «لطفاً»
  if (/لطف[اآ]ً?/.test(text)) rules.push("R2");

  // R3 — «کلیک» به‌جای نام‌بردن فعل
  if (text.includes("کلیک")) rules.push("R3");

  // R4 — خطای بدون راه‌حل
  const hasFailure = FAILURE_MARKERS.some((re) => re.test(text));
  const hasAction = ACTION_VERBS.some((a) => text.includes(a));
  if (text.length >= MESSAGE_MIN_LENGTH && hasFailure && !hasAction) rules.push("R4");

  // R5 — واژهٔ داخلی/فنی
  if (INTERNAL_JARGON.some((j) => text.includes(j))) rules.push("R5");

  // R7 — نگارش معیار (بدون شکسته‌نویسی)
  if (BROKEN_RES.some((re) => re.test(normWord(text)))) rules.push("R7");

  return rules;
}

/** جزئیات فارسی هر قاعده — برای گزارش تست و CLI. */
export const RULE_DETAIL = {
  R1: "خطاب در هر فایل باید یکدست باشد: پیش‌فرض «تو»، فقط صفحات حقوقی «شما».",
  R2: "«لطفاً» در متن کاربر نداریم؛ لحن گرم خودش احترام است.",
  R3: "به‌جای «کلیک»، فعل همان کار را نام ببر («انتخاب کن»، «بزن»).",
  R4: "پیام خطا باید راه‌حل هم بدهد: «[چه شد]؛ [چه کار کن]».",
  R5: "اصطلاح داخلی/فنی نباید به کاربر نمایش داده شود.",
  R6: "این متن در بیش از یک فایل تکرار شده؛ باید از یک منبع مشترک بیاید.",
  R7: "صمیمی یعنی دوم‌شخص مفرد، نه شکسته‌نویسی: «را» بنویس، نه «رو».",
};

/** عنوان کوتاه هر قاعده برای پیام خطای تست. */
export const RULE_TITLE = {
  R1: "یکدستی خطاب",
  R2: "بدون «لطفاً»",
  R3: "بدون «کلیک»",
  R4: "خطا باید راه‌حل بدهد",
  R5: "بدون اصطلاح داخلی",
  R6: "متن مشترک تک‌منبعی",
  R7: "نگارش معیار",
};

/**
 * آیا این متن به‌صورت literal رشته‌ای (کوتیشن یا بک‌تیک) در سورس تعریف شده؟
 *
 * برای قاعدهٔ R6: مصرف از ثابت مشترک (مثل {COPY.addToCart} یا `${COPY.free}`)
 * «تکرار» نیست — رشته فقط یک‌جا تعریف می‌شود. پس تطبیق باید روی تعریف واقعی
 * رشته باشد، نه روی هر اشاره‌ای به کلمات.
 */
export function hasStringLiteral(src, needle) {
  return src.includes(`"${needle}"`) || src.includes(`'${needle}'`) || src.includes(`\`${needle}\``);
}
