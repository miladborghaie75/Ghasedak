/**
 * مغزِ ویرایشگرِ ساختاریافتهٔ بخش‌های صفحهٔ محتوایی — بی‌React و بی‌رندر.
 *
 * چرا این فایل هست؟ متن هر بخش در بلوک `CONTENT_PAGE` با یک نشانه‌گذاریِ
 * کم‌نشانه ذخیره می‌شود (`- ` فهرست، `> ` یادداشت، `[متن](پیوند)` و
 * `**متن**`). آن نشانه‌گذاری برای ذخیرهٔ امن و رفت‌وبرگشتِ دقیق خوب است، ولی
 * مدیر باید یادش می‌گرفت — و یک تایپِ اشتباه، ساختار یا پیوند را بی‌صدا
 * می‌شکست. اینجا همان متن به مدلی «برای ویرایش» تبدیل می‌شود: هر خط یک
 * بند/عضو فهرست/یادداشت با **متنِ ساده** و چند **نشانه** (پیوند/برجسته) که
 * روی همان متن می‌نشیند. فرم فقط همین مدل را عوض می‌کند و هنگامِ ذخیره
 * دوباره نشانه‌گذاری می‌شود.
 *
 * دو قاعده‌ای که کلِ این فایل رویشان می‌چرخد:
 *  ۱) **رفت‌وبرگشتِ بی‌کم‌و‌اضافه:** متنِ موجود، بی‌آنکه چیزی گم شود، به مدل
 *     و برگردد. تستِ `content-sections.test.ts` این را روی هر شش صفحهٔ واقعی
 *     می‌سنجد.
 *  ۲) **نشانه با متنش شناخته می‌شود، نه با شمارهٔ نویسه:** اگر مدیر جمله را
 *     ویرایش کند، پیوند از جایش نمی‌پرد و به نویسه‌های تصادفی نمی‌چسبد؛ فقط
 *     وقتی خودِ عبارتِ نشانه‌دار عوض شود، نشانه «پیدا نشد» می‌شود و فرم
 *     هشدار می‌دهد (پاک نمی‌شود، پنهان هم نمی‌شود).
 */
import { isSafeHref, linesToBody, parseBody } from "@ghasedak/contracts";

/** یک نشانه روی متن: پیوند، برجسته، یا هر دو */
export interface SectionMark {
  /** عبارتِ دقیقی که نشانه رویش می‌نشیند — همان متنی که در صفحه دیده می‌شود */
  text: string;
  /** نشانی پیوند — خالی یعنی این نشانه فقط برجسته است */
  href?: string;
  /** برجسته (پُررنگ) */
  strong?: boolean;
  /**
   * جای شروعِ نشانه در متنِ همین خط.
   *
   * چرا موقعیت و نه فقط عبارت؟ چون یک عبارت می‌تواند در یک جمله دو بار
   * بیاید و فقط یکی‌شان پیوند باشد — مثلاً «صفحهٔ [پیگیری سفارش](/order)
   * را باز کن» که «پیگیری سفارش» دو بار در متن است. با جست‌وجوی متنی، پیوند
   * روی Occurrence اشتباه می‌نشست و با یک ذخیره متنِ صفحه عوض می‌شد. با
   * موقعیت، نشانه همان‌جا می‌ماند و هنگامِ ویرایشِ متن هم جابه‌جا می‌شود
   * (`editLineText`).
   */
  at?: number;
}

/** یک خط از بخش — همان چیزی که در سایت یک بند/عضو فهرست/یادداشت می‌شود */
export interface SectionLine {
  kind: "p" | "li" | "note";
  /** متنِ خالص (بی‌نشانه) */
  text: string;
  marks: SectionMark[];
}

/** سطرِ قابلِ‌ویرایش — `id` فقط برای پایدار ماندنِ فوکوس و کلیدِ React است، ذخیره نمی‌شود */
export interface EditorLine extends SectionLine {
  id: string;
}

/** یک بخش از صفحه — تیتر + خطوط */
export interface EditorSection {
  id: string;
  title: string;
  lines: EditorLine[];
}

/** شکلِ ذخیره‌شده در بلوک (همان `sections` در props) */
export interface SectionValueRow {
  title: string;
  body: string;
}

let seq = 0;
/** شناسهٔ پایدارِ سطر/بخش در همین نشست — فقط برای کلیدِ React و نگه‌داشتنِ فوکوس */
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}${seq.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** یک نشانه واقعاً چیزی عوض می‌کند؟ (پیوندِ بی‌نشانی و برجستهٔ خاموش، بی‌اثرند) */
export function markEffective(mark: SectionMark): boolean {
  return Boolean(mark.text) && (Boolean(mark.strong) || Boolean(mark.href && isSafeHref(mark.href)));
}

/**
 * متنِ نشانه‌گذاری‌شده → خطوطِ قابلِ‌ویرایش.
 *
 * هر خطِ نشانه‌گذاری‌شده یک خط می‌شود؛ تکه‌های نشانه‌دار جداشده و متنِ ساده
 * به‌هم‌چسبیده. خطِ خالی (فقط جداکنندهٔ خوانا) دور ریخته می‌شود — همان کاری
 * که رندر هم می‌کند.
 */
export function linesFromBody(body: string): SectionLine[] {
  const out: SectionLine[] = [];
  for (const line of parseBody(body)) {
    let text = "";
    const marks: SectionMark[] = [];
    for (const span of line.spans) {
      if (!span.text) continue;
      if (span.href || span.strong) {
        marks.push({
          text: span.text,
          at: text.length,
          ...(span.href ? { href: span.href } : {}),
          ...(span.strong ? { strong: true } : {}),
        });
      }
      text += span.text;
    }
    // خطی که نه متنی دارد نه نشانه‌ای، در سایت چیزی نشان نمی‌دهد
    if (!text && marks.length === 0) continue;
    out.push({ kind: line.kind, text, marks });
  }
  return out;
}

/**
 * جای هر نشانه در متن — **به ترتیبِ متن**، بدون هم‌پوشانی.
 *
 * چرا به ترتیبِ متن و نه به ترتیبِ فهرست؟ چون فرم ممکن است نشانه‌ای را دیرتر
 * اضافه کند (مدیر اول پیوندِ آخر جمله را می‌سازد، بعد پیوندِ اول را). با
 * جست‌وجوی ترتیبیِ ساده، نشانهٔ دوم می‌توانست جای اولی را بگیرد. اینجا هر
 * نشانه جای خودش را می‌یابد و اگر با نشانهٔ قبلی هم‌پوشانی داشته باشد
 * (دو نشانه روی یک عبارت) فقط اولی می‌نشیند — بی‌آنکه متنی گم شود.
 */
/**
 * جای یک نشانه در متن — اول موقعیتِ ذخیره‌شده، بعد جست‌وجوی متنی.
 *
 * موقعیت فقط وقتی معتبر است که متنِ همان‌جا هنوز عبارتِ نشانه باشد؛ وگرنه
 * (مثلاً بعد از ویرایشِ داخلِ خودِ عبارت) به جست‌وجوی متنی برمی‌گردد و اگر
 * نبود، `-1`. این‌طور «نشانهٔ گم‌شده» به نویسه‌های تصادفی نمی‌چسبد.
 */
function markIndex(line: SectionLine, mark: SectionMark): number {
  if (typeof mark.at === "number" && mark.at >= 0 && line.text.startsWith(mark.text, mark.at)) {
    return mark.at;
  }
  return line.text.indexOf(mark.text);
}

export function resolvedMarks(line: SectionLine): Array<{ at: number; mark: SectionMark }> {
  const found: Array<{ at: number; mark: SectionMark }> = [];
  for (const mark of line.marks) {
    if (!markEffective(mark)) continue;
    const at = markIndex(line, mark);
    if (at < 0) continue;
    found.push({ at, mark });
  }
  found.sort((a, b) => a.at - b.at || b.mark.text.length - a.mark.text.length);
  const out: Array<{ at: number; mark: SectionMark }> = [];
  let cursor = 0;
  for (const hit of found) {
    if (hit.at < cursor) continue;
    out.push(hit);
    cursor = hit.at + hit.mark.text.length;
  }
  return out;
}

/** نشانه در متنِ این خط پیدا می‌شود؟ — برای هشدارِ فرم، نه برای ذخیره */
export function markFound(line: SectionLine, mark: SectionMark): boolean {
  return Boolean(mark.text) && markIndex(line, mark) >= 0;
}

/**
 * ویرایشِ متنِ یک خط + جابه‌جاییِ نشانه‌ها.
 *
 * نشانه‌ها با موقعیت شناخته می‌شوند، پس اگر مدیر جمله را قبل از پیوند عوض
 * کند، پیوند باید همراهِ جمله سرِ جایش بماند. تغییر را به «پیشوندِ مشترک +
 * پسوندِ مشترک» می‌شکنیم (همان کاری که diffهای متنی می‌کنند):
 *  • نشانه‌ای که کاملاً پیش از تغییر است، دست نمی‌خورد؛
 *  • نشانه‌ای که کاملاً پس از تغییر است، به اندازهٔ اختلاف جابه‌جا می‌شود؛
 *  • نشانه‌ای که تغییر وسطش افتاده، موقعیتش رها می‌شود تا جست‌وجوی متنی
 *    جایش را پیدا کند (و اگر نتواند، فرم هشدار می‌دهد) — هیچ‌وقت بی‌صدا
 *    روی متنِ نامربوط نمی‌نشیند.
 */
export function editLineText<T extends SectionLine>(line: T, next: string): T {
  const prev = line.text;
  if (prev === next) return line;
  let prefix = 0;
  const max = Math.min(prev.length, next.length);
  while (prefix < max && prev[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < prev.length - prefix &&
    suffix < next.length - prefix &&
    prev[prev.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const changeEnd = prev.length - suffix;
  const delta = next.length - prev.length;
  const marks = line.marks.map((mark) => {
    const at = typeof mark.at === "number" ? mark.at : prev.indexOf(mark.text);
    if (at < 0) return { ...mark, at: undefined };
    const end = at + mark.text.length;
    if (end <= prefix) return mark;
    if (at >= changeEnd) return { ...mark, at: at + delta };
    return { ...mark, at: undefined };
  });
  return { ...line, text: next, marks } as T;
}

/** خطوطِ قابلِ‌ویرایش → متنِ نشانه‌گذاری‌شده (جفت‌وشِ `linesFromBody`) */
export function bodyFromLines(lines: SectionLine[]): string {
  const body = lines
    // خطِ بی‌متن چیزی برای نشان‌دادن ندارد؛ در متنِ ذخیره هم لازم نیست
    .filter((line) => line.text.trim() !== "")
    .map((line) => {
      const spans: Array<{ text: string; href?: string; strong?: boolean }> = [];
      let cursor = 0;
      for (const { at, mark } of resolvedMarks(line)) {
        if (at > cursor) spans.push({ text: line.text.slice(cursor, at) });
        spans.push({
          text: mark.text,
          ...(mark.href && isSafeHref(mark.href) ? { href: mark.href } : {}),
          ...(mark.strong ? { strong: true } : {}),
        });
        cursor = at + mark.text.length;
      }
      if (cursor < line.text.length) spans.push({ text: line.text.slice(cursor) });
      return { kind: line.kind, spans };
    });
  return linesToBody(body);
}

/**
 * ویرایشِ متنِ **یک خط** از یک سطرِ `sections` — همان چیزی که ویرایشِ درجا
 * روی بوم لازم دارد.
 *
 * چرا این تابع جدا از فرمِ پنل است؟ بوم فقط «متنِ خط» را می‌فرستد؛ نمی‌تواند
 * پیوند/برجسته را بفرستد (در HTMLِ رندرشده نشانه‌ها به `<a>`/`<strong>`
 * تبدیل شده‌اند). اینجا همان خط با `editLineText` ویرایش می‌شود تا نشانه‌ها
 * با موقعیتِ خودشان جابه‌جا شوند و نوعِ خط (`- `/`> `) و بقیهٔ سطرها دست‌نخورده
 * بمانند. خطِ تازه‌خط‌دار هم به یک خطِ ساده جمع می‌شود؛ این زبان هر خط را
 * یک بند می‌داند و نمی‌تواند خطِ تازه درونِ یک خط را نگه دارد.
 */
export function editBodyLine(
  rows: unknown,
  sectionIndex: number,
  lineIndex: number,
  nextText: string,
): unknown[] {
  const list = Array.isArray(rows) ? rows : [];
  if (!Number.isInteger(sectionIndex) || sectionIndex < 0) return list;
  if (!Number.isInteger(lineIndex) || lineIndex < 0) return list;
  const text = String(nextText ?? "").replace(/\r?\n+/g, " ");

  return list.map((row, si) => {
    if (si !== sectionIndex || !row || typeof row !== "object") return row;
    const src = row as Record<string, unknown>;
    const body = typeof src.body === "string" ? src.body : "";
    const lines = linesFromBody(body);
    if (!lines[lineIndex]) return row;
    const next = lines.map((line, i) => (i === lineIndex ? editLineText(line, text) : line));
    return { ...src, body: bodyFromLines(next) };
  });
}

/** مقدارِ ذخیره‌شدهٔ `sections` → مدلِ ویرایش (مقادیر ناشناخته بی‌صدا دور ریخته می‌شوند) */
export function sectionsFromValue(value: unknown): EditorSection[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    .map((row) => ({
      id: uid("s"),
      title: typeof row.title === "string" ? row.title : "",
      lines: linesFromBody(typeof row.body === "string" ? row.body : "").map((line) => ({
        ...line,
        id: uid("l"),
      })),
    }));
}

/** مدلِ ویرایش → همان چیزی که در props ذخیره می‌شود */
export function valueFromSections(sections: EditorSection[]): SectionValueRow[] {
  return sections.map((section) => ({
    title: section.title,
    body: bodyFromLines(section.lines),
  }));
}

/** بخشِ تازه — خالی، تا مدیر از صفر شروع کند */
export function blankSection(): EditorSection {
  return { id: uid("s"), title: "", lines: [] };
}

/** یک خطِ تازه از نوعِ خواسته‌شده */
export function blankLine(kind: SectionLine["kind"] = "p"): EditorLine {
  return { id: uid("l"), kind, text: "", marks: [] };
}
