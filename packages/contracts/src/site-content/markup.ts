import type {
  SiteContentBlock,
  SiteContentParagraph,
  SiteContentSection,
  SiteContentSegment,
} from "./types";
import { segmentsOf } from "./types";

/**
 * نشانه‌گذاریِ متنِ صفحه‌های محتوایی — زبان مشترکِ «منبع متن در کد» و «بلوک صفحه‌ساز».
 *
 * چرا این فایل هست؟ صفحه‌های محتوایی (درباره ما، تماس، قوانین، حریم، ارسال،
 * بازگشت) باید هم از منبعِ متن در کد رندر شوند و هم در صفحه‌ساز قابل ویرایش
 * باشند. اگر متنِ بلوک یک رشتهٔ ساده بود، پیوندِ شمارهٔ تماس و شکلِ «فهرست» در
 * تبدیل گم می‌شدند؛ و اگر JSON ساخت‌یافته بود، مدیر باید JSON ویرایش می‌کرد.
 * پس مدلِ ذخیره یک متنِ کم‌نشانه است با پنج قاعدهٔ ثابت:
 *
 *   خطِ خالی ......... فقط جداکنندهٔ خوانا (در رندر بی‌اثر است)
 *   خط با "- " ....... یک عضوِ فهرست
 *   خط با "> " ....... یک یادداشت (کادرِ کم‌رنگ)
 *   [متن](پیوند) ..... پیوند
 *   **متن** .......... برجسته
 *
 * قواعد عمداً شبیه مارک‌داون‌اند تا مدیر با یک خط راهنما یادشان بگیرد، و
 * عمداً کوچک‌اند تا «هیچ‌چیز از متن گم نشود» قابل تست باشد: `sectionToBody` و
 * `bodyToBlocks` جفت‌وشی‌اند و تستِ رفت‌وبرگشت دارند.
 *
 * نشانه‌هایی که **عمداً** در این زبان نیستند (و در تبدیل از مدلِ غنی از دست
 * می‌روند): `muted` (متن کوچک و کم‌رنگ) و `ltr`/`external` که به‌صورت خودکار
 * از نشانی پیوند استخراج می‌شوند (`tel:`/`mailto:` چپ‌به‌راست؛ `http(s):` در
 * تب تازه).
 */

/** یک تکهٔ متن درونِ یک خط — ساده، پیوندی یا برجسته */
export interface ContentSpan {
  text: string;
  /** نشانی پیوند — خالی یعنی متن ساده */
  href?: string;
  /** برجسته (مثل نام شعبه یا شمارهٔ تماس) */
  strong?: boolean;
}

/** یک خط از متنِ بخش — پاراگراف، عضوِ فهرست، یا یادداشت */
export interface ContentLine {
  kind: "p" | "li" | "note";
  spans: ContentSpan[];
}

const LINK_RE = /\[([^\]]+)\]\(([^()\s]+)\)/g;
const STRONG_RE = /\*\*([^*]+)\*\*/g;

/**
 * فقط پیوندهای بی‌خطر در متن می‌مانند.
 *
 * این زبان «نشانه» است، نه پاک‌ساز؛ اما رندرش با `<a href>` انجام می‌شود و
 * پیشوند `javascript:` یک لینکِ کلی‌شدنیِ خطرناک می‌سازد. پس همین‌جا پیوندِ
 * ناامن خوانده نمی‌شود و متنِ برچسب به‌صورت ساده می‌ماند — بدون آنکه چیزی
 * از متن گم شود. مسیرهای داخلی، `mailto:`/`tel:` و `http(s):` مجازند.
 */
function safeHref(raw: string): string | undefined {
  const s = String(raw ?? "").trim();
  if (!s) return undefined;
  if (s.startsWith("/") || s.startsWith("#")) return s;
  if (/^(mailto:|tel:)/i.test(s)) return s;
  if (/^https?:\/\//i.test(s)) return s;
  return undefined;
}

/**
 * آیا این نشانی برای یک پیوندِ متن مجاز است؟
 *
 * چرا عمومی است: فرمِ ویرایشِ بخش‌ها در پنل باید **پیش از ذخیره** همان
 * قاعده‌ای را بسنجد که رندر می‌سنجد. وگرنه مدیر نشانی‌ای می‌نویسد که فرم
 * می‌پذیرد و سایت پیوندش نمی‌کند — بی‌آنکه کسی بفهمد چرا.
 */
export function isSafeHref(raw: string): boolean {
  return safeHref(raw) !== undefined;
}

/** تکه‌های بدون پیوند — برای پردازشِ برجسته درون و بیرونِ پیوند */
function parseStrong(text: string): Array<{ text: string; strong: boolean }> {
  const out: Array<{ text: string; strong: boolean }> = [];
  let last = 0;
  STRONG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STRONG_RE.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), strong: false });
    out.push({ text: m[1], strong: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), strong: false });
  return out;
}

/** خواندن یک خطِ نشانه‌گذاری‌شده به تکه‌ها — پیوند و برجسته هم‌زمان هم می‌آیند (`[**متن**](لینک)`) */
export function parseInline(raw: string): ContentSpan[] {
  const text = String(raw ?? "");
  if (!text) return [];
  const out: ContentSpan[] = [];
  let last = 0;
  LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINK_RE.exec(text))) {
    if (m.index > last) {
      for (const s of parseStrong(text.slice(last, m.index))) {
        out.push(s.strong ? { text: s.text, strong: true } : { text: s.text });
      }
    }
    const label = m[1];
    const href = safeHref(m[2]);
    if (!href) {
      // پیوند ناامن — خوانده نمی‌شود؛ برچسب به‌صورت متن ساده ادامه می‌یابد
      for (const s of parseStrong(label)) {
        out.push(s.strong ? { text: s.text, strong: true } : { text: s.text });
      }
      last = m.index + m[0].length;
      continue;
    }
    const inner = parseStrong(label);
    if (inner.length === 1 && inner[0].strong) out.push({ text: inner[0].text, href, strong: true });
    else out.push({ text: label, href });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    for (const s of parseStrong(text.slice(last))) {
      out.push(s.strong ? { text: s.text, strong: true } : { text: s.text });
    }
  }
  return out;
}

/** بازنویسیِ تکه‌ها به متنِ نشانه‌گذاری‌شده — جفت‌وشِ دقیقِ `parseInline` */
export function spansToText(spans: ContentSpan[]): string {
  return spans
    .map((s) => {
      const inner = s.strong ? `**${s.text}**` : s.text;
      return s.href ? `[${inner}](${s.href})` : inner;
    })
    .join("");
}

/** خواندن متنِ کاملِ یک بخش به خطوط — هر خطِ غیرخالی یک بند است */
export function parseBody(body: string): ContentLine[] {
  const out: ContentLine[] = [];
  for (const raw of String(body ?? "").split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    if (line.startsWith("- ")) out.push({ kind: "li", spans: parseInline(line.slice(2)) });
    else if (line.startsWith("> ")) out.push({ kind: "note", spans: parseInline(line.slice(2)) });
    else out.push({ kind: "p", spans: parseInline(line) });
  }
  return out;
}

/** بازنویسیِ خطوط به متنِ بخش — جفت‌وشِ دقیقِ `parseBody` */
export function linesToBody(lines: ContentLine[]): string {
  return lines
    .map((l) => {
      const t = spansToText(l.spans);
      if (l.kind === "li") return `- ${t}`;
      if (l.kind === "note") return `> ${t}`;
      return t;
    })
    .join("\n");
}

/** تکه‌های مدلِ غنی → تکه‌های متنِ نشانه‌گذاری‌شده */
function segmentsToSpans(segments: SiteContentSegment[]): ContentSpan[] {
  return segments.map((s) => ({
    text: s.text,
    ...(s.href ? { href: s.href } : {}),
    ...(s.strong ? { strong: true } : {}),
  }));
}

/** تکه‌های نشانه‌گذاری‌شده → بندِ مدلِ غنی (متنِ ساده بدون نشانه برمی‌گردد) */
function spansToParagraph(spans: ContentSpan[]): SiteContentParagraph {
  if (spans.length === 1 && !spans[0].href && !spans[0].strong) return spans[0].text;
  return spans.map((s) => ({
    text: s.text,
    ...(s.href ? { href: s.href } : {}),
    ...(s.strong ? { strong: true } : {}),
  })) as SiteContentSegment[];
}

/** یک بخش از محتوای مشترک → متنِ قابل‌ویرایشِ بلوک (تیتر جدا است) */
export function sectionToBody(section: SiteContentSection): string {
  const lines: ContentLine[] = [];
  for (const block of section.blocks) {
    if (block.kind === "list") {
      for (const item of block.items) lines.push({ kind: "li", spans: segmentsToSpans(segmentsOf(item)) });
    } else if (block.kind === "note") {
      lines.push({ kind: "note", spans: segmentsToSpans(segmentsOf(block.text)) });
    } else {
      lines.push({ kind: "p", spans: segmentsToSpans(segmentsOf(block.text)) });
    }
  }
  return linesToBody(lines);
}

/** متنِ قابل‌ویرایشِ بلوک → بندهای مدلِ غنی — فهرستِ پشت‌سرهم یک بندِ فهرست می‌شود */
export function bodyToBlocks(body: string): SiteContentBlock[] {
  const blocks: SiteContentBlock[] = [];
  let list: SiteContentParagraph[] | null = null;
  const flush = () => {
    if (list && list.length) blocks.push({ kind: "list", items: list });
    list = null;
  };
  for (const line of parseBody(body)) {
    if (line.kind === "li") {
      (list ??= []).push(spansToParagraph(line.spans));
      continue;
    }
    flush();
    blocks.push(
      line.kind === "note"
        ? { kind: "note", text: spansToParagraph(line.spans) }
        : { kind: "paragraph", text: spansToParagraph(line.spans) },
    );
  }
  flush();
  return blocks;
}
