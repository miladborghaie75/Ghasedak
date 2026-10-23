"use client";

import { useEffect, useRef, useState } from "react";
import { isSafeHref } from "@ghasedak/contracts";
import { moveItem } from "@/lib/reorder";
import {
  blankLine,
  blankSection,
  editLineText,
  markEffective,
  markFound,
  sectionsFromValue,
  valueFromSections,
  type EditorLine,
  type EditorSection,
  type SectionLine,
  type SectionValueRow,
} from "@/lib/content-sections";

/**
 * ویرایشگرِ **ساختاریافتهٔ** بخش‌های صفحهٔ محتوایی — به‌جای یک textarea با
 * نشانه‌گذاری.
 *
 * چرا این فرم؟ نشانه‌گذاری برای ذخیره خوب است (`- ` فهرست، `[متن](پیوند)` و
 * …) ولی مدیر باید یادش می‌گرفت و یک تایپِ اشتباه، ساختار یا پیوند را بی‌صدا
 * می‌شکست. اینجا:
 *  • هر بخش یک تیتر + چند **خط** است که نوعشان با یک انتخابگر عوض می‌شود
 *    (بند / عضوِ فهرست / یادداشت) — پس «فهرست» و «یادداشت» فیلدِ خودشان را
 *    دارند، نه یک قاعدهٔ تایپی؛
 *  • پیوند و برجسته با انتخابِ عبارت روی همان متن ساخته می‌شوند (`+ پیوند`,
 *    `+ برجسته`)، پس نشانی و عبارتِ نمایشی هر دو فیلد دارند و مدیر هرگز
 *    `[...](...)` نمی‌نویسد؛
 *  • جابه‌جایی و حذفِ بخش و خط با دکمه است و از `moveItem` رد می‌شود.
 *
 * مدلِ ذخیره همان `sections: [{ title, body }]` می‌ماند (متنِ نشانه‌گذاری‌شده)
 * — یعنی API، پاک‌سازی و رندرِ سایت هیچ تغییری نمی‌خواهند و متنِ قدیمی هم
 * بدون مهاجرت خوانده می‌شود ([content-sections.ts](../../lib/content-sections.ts)).
 */

const KIND_LABEL: Record<SectionLine["kind"], string> = {
  p: "بند",
  li: "عضو فهرست",
  note: "یادداشت",
};

const inputCls =
  "mt-1 block w-full rounded-lg border border-app-line bg-app-surface px-2.5 py-1.5 text-[12px] text-app-ink outline-none focus:border-app-primary-soft";

/** دکمهٔ کوچکِ کنشی — همهٔ دکمه‌های این فرم همین اندازه‌اند تا ستونِ باریکِ پنل شلوغ نشود */
const miniBtn =
  "rounded-md border border-app-line px-1.5 py-0.5 text-[10px] font-bold text-app-muted hover:border-app-primary-soft hover:text-app-primary-strong disabled:opacity-30";

export default function ContentSectionsEditor({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (rows: SectionValueRow[]) => void;
}) {
  const [sections, setSections] = useState<EditorSection[]>(() => sectionsFromValue(value));
  /**
   * آخرین مقداری که **خودمان** ساختیم.
   *
   * چرا لازم است: مقدارِ props بعد از هر تغییرِ ما هم عوض می‌شود. اگر هر
   * تغییرِ props را «تغییرِ بیرونی» بشماریم و از نو بسازیم، نشانه‌ها هنگامِ
   * تایپ ساخته‌و‌پاک می‌شدند و نشانگرِ متن می‌پرید. پس فقط وقتی دوباره
   * می‌سازیم که مقدار از بیرون آمده باشد (واگرد، بازگردانیِ نسخه، بازسازی).
   */
  const lastEmit = useRef<unknown>(value);
  /** بخشی که تازه اضافه شده — تیترش باید فوکوس بگیرد */
  const [focusSection, setFocusSection] = useState<string | null>(null);

  useEffect(() => {
    if (value === lastEmit.current) return;
    lastEmit.current = value;
    setSections(sectionsFromValue(value));
  }, [value]);

  useEffect(() => {
    if (!focusSection) return;
    const el = document.querySelector<HTMLInputElement>(`[data-section-title="${focusSection}"]`);
    el?.focus();
    setFocusSection(null);
  }, [focusSection, sections]);

  const emit = (next: EditorSection[]) => {
    setSections(next);
    const rows = valueFromSections(next);
    lastEmit.current = rows;
    onChange(rows);
  };

  const setSection = (idx: number, patch: Partial<EditorSection>) =>
    emit(sections.map((s, i) => (i === idx ? { ...s, ...patch } : s)));

  const addSection = () => {
    const fresh = blankSection();
    setFocusSection(fresh.id);
    emit([...sections, fresh]);
  };

  return (
    <div className="mt-1 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-bold text-app-muted">بخش‌ها</span>
        <span className="text-[10px] text-app-muted">
          {sections.length === 0 ? "خالی" : `${sections.length.toLocaleString("fa-IR")} بخش`}
        </span>
      </div>
      <p className="text-[10px] leading-5 text-app-muted">
        هر بخش یک تیتر و چند خط دارد. نوعِ هر خط را انتخاب کن؛ برای پیوند، اول عبارت را در متن انتخاب کن و «پیوند» را بزن.
      </p>

      {sections.length === 0 && (
        <p className="rounded-xl border border-dashed border-app-line p-4 text-center text-[11px] leading-6 text-app-muted">
          این صفحه هنوز بخشی ندارد. با «بخش تازه» اولین بخش را بساز.
        </p>
      )}

      {sections.map((section, idx) => (
        <SectionCard
          key={section.id}
          section={section}
          index={idx}
          count={sections.length}
          onTitle={(title) => setSection(idx, { title })}
          onLines={(lines) => setSection(idx, { lines })}
          onMove={(dir) => emit(moveItem(sections, idx, idx + dir))}
          onRemove={() => emit(sections.filter((_, i) => i !== idx))}
        />
      ))}

      <button
        type="button"
        onClick={addSection}
        className="w-full rounded-xl border border-dashed border-app-line py-2 text-[11px] font-bold text-app-primary-strong hover:bg-app-primary-tint"
      >
        + بخش تازه
      </button>
    </div>
  );
}

/** یک بخش: تیتر + خطوط + دکمه‌های افزودن */
function SectionCard({
  section,
  index,
  count,
  onTitle,
  onLines,
  onMove,
  onRemove,
}: {
  section: EditorSection;
  index: number;
  count: number;
  onTitle: (title: string) => void;
  onLines: (lines: EditorLine[]) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const add = (kind: SectionLine["kind"]) => onLines([...section.lines, blankLine(kind)]);

  return (
    <div className="rounded-xl border border-app-line bg-app-bg/50 p-2">
      <div className="flex items-center gap-1">
        <span className="shrink-0 text-[10px] font-bold text-app-muted">#{index + 1}</span>
        <input
          type="text"
          data-section-title={section.id}
          value={section.title}
          placeholder="تیتر بخش (مثلاً: روش‌های ارسال)"
          maxLength={200}
          onChange={(e) => onTitle(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-app-line bg-app-surface px-2 py-1.5 text-[12px] font-bold text-app-ink outline-none focus:border-app-primary-soft"
        />
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={index === 0}
          className={miniBtn}
          title="بخش بالاتر"
          aria-label="بخش بالاتر"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={index === count - 1}
          className={miniBtn}
          title="بخش پایین‌تر"
          aria-label="بخش پایین‌تر"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={onRemove}
          className={`${miniBtn} text-app-error`}
          title="حذف بخش"
          aria-label="حذف بخش"
        >
          ✕
        </button>
      </div>

      <div className="mt-1.5 space-y-1.5">
        {section.lines.length === 0 && (
          <p className="rounded-lg border border-dashed border-app-line px-2 py-2 text-center text-[10px] text-app-muted">
            این بخش هنوز متنی ندارد.
          </p>
        )}
        {section.lines.map((line, li) => (
          <LineRow
            key={line.id}
            line={line}
            index={li}
            count={section.lines.length}
            onChange={(next) => onLines(section.lines.map((l, i) => (i === li ? next : l)))}
            onMove={(dir) => onLines(moveItem(section.lines, li, li + dir))}
            onRemove={() => onLines(section.lines.filter((_, i) => i !== li))}
          />
        ))}
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1">
        <button type="button" onClick={() => add("p")} className={miniBtn}>
          + بند
        </button>
        <button type="button" onClick={() => add("li")} className={miniBtn}>
          + فهرست
        </button>
        <button type="button" onClick={() => add("note")} className={miniBtn}>
          + یادداشت
        </button>
      </div>
    </div>
  );
}

/** یک خط: نوع، متن، نشانه‌ها (پیوند/برجسته) و کنش‌ها */
function LineRow({
  line,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  line: EditorLine;
  index: number;
  count: number;
  onChange: (next: EditorLine) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  /** کدام نشانه برای ویرایش باز شده — با شماره، چون نشانه‌ها هویتِ پایدار ندارند */
  const [openMark, setOpenMark] = useState<number | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const setMark = (i: number, patch: Partial<(typeof line.marks)[number]>) =>
    onChange({ ...line, marks: line.marks.map((m, idx) => (idx === i ? { ...m, ...patch } : m)) });

  const dropMark = (i: number) => {
    onChange({ ...line, marks: line.marks.filter((_, idx) => idx !== i) });
    setOpenMark(null);
  };

  /**
   * ساختِ پیوند/برجسته از **انتخابِ** متن.
   *
   * چرا از انتخاب؟ چون نشانه با عبارتِ نمایشی‌اش شناخته می‌شود
   * (`markFound`/`resolvedMarks`)؛ اگر مدیر خودش عبارت را تایپ کند، یک
   * نویسهٔ اشتباه یعنی پیوندی که بی‌صدا اعمال نمی‌شود. انتخاب، همان متن را
   * می‌آورد.
   */
  const addMark = (kind: "link" | "strong") => {
    const ta = taRef.current;
    if (!ta) return;
    const picked = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    const raw = picked.trim();
    if (!raw) {
      setHint("اول عبارتِ موردنظر را در متن انتخاب کن، بعد «پیوند» یا «برجسته» را بزن.");
      return;
    }
    setHint(null);
    /** فاصلهٔ سفیدِ ابتدای انتخاب، آفست را جابه‌جا می‌کند — نشانه باید روی خودِ عبارت بنشیند */
    const start = ta.selectionStart + (picked.length - picked.trimStart().length);
    // همان عبارت دقیقاً همان‌جا از قبل نشانه دارد؟ نشانهٔ تازه روی همان می‌نشیند
    const existing = line.marks.findIndex((m) => m.text === raw && m.at === start);
    if (existing >= 0) {
      setMark(existing, kind === "link" ? { href: line.marks[existing].href ?? "" } : { strong: true });
      setOpenMark(existing);
      return;
    }
    const mark =
      kind === "link" ? { text: raw, at: start, href: "" } : { text: raw, at: start, strong: true };
    onChange({ ...line, marks: [...line.marks, mark] });
    setOpenMark(line.marks.length);
  };

  return (
    <div className="rounded-lg border border-app-line bg-app-surface p-1.5">
      <div className="flex items-center gap-1">
        <select
          value={line.kind}
          onChange={(e) => onChange({ ...line, kind: e.target.value as SectionLine["kind"] })}
          className="min-w-0 flex-1 rounded-md border border-app-line bg-app-bg px-1.5 py-1 text-[10px] font-bold text-app-ink outline-none focus:border-app-primary-soft"
          aria-label="نوع خط"
        >
          {(Object.keys(KIND_LABEL) as Array<SectionLine["kind"]>).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={index === 0}
          className={miniBtn}
          title="خط بالاتر"
          aria-label="خط بالاتر"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={index === count - 1}
          className={miniBtn}
          title="خط پایین‌تر"
          aria-label="خط پایین‌تر"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={onRemove}
          className={`${miniBtn} text-app-error`}
          title="حذف خط"
          aria-label="حذف خط"
        >
          ✕
        </button>
      </div>

      <textarea
        ref={taRef}
        rows={line.kind === "note" ? 3 : 2}
        value={line.text}
        placeholder={
          line.kind === "li"
            ? "یک عضو از فهرست — مثلاً: ارسال رایگان بالای ۵۰۰ هزار تومان"
            : line.kind === "note"
              ? "یادداشت — کادرِ کم‌رنگ برای نکتهٔ مهم"
              : "یک بند — هر خط یک بند است"
        }
        onChange={(e) => onChange(editLineText(line, e.target.value))}
        className={`${inputCls} leading-6`}
      />

      <div className="mt-1 flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => addMark("link")} className={miniBtn} title="از عبارتِ انتخاب‌شده پیوند بساز">
          🔗 پیوند
        </button>
        <button type="button" onClick={() => addMark("strong")} className={miniBtn} title="عبارتِ انتخاب‌شده را برجسته کن">
          B برجسته
        </button>
        {line.marks.map((m, i) => {
          const found = markFound(line, m);
          const unsafe = Boolean(m.href) && !isSafeHref(m.href ?? "");
          const broken = !found || unsafe;
          return (
            <button
              key={`${m.text}-${i}`}
              type="button"
              onClick={() => setOpenMark(openMark === i ? null : i)}
              aria-pressed={openMark === i}
              title={
                unsafe
                  ? "نشانیِ این پیوند مجاز نیست"
                  : found
                    ? "ویرایشِ پیوند/برجسته"
                    : "این عبارت در متن نیست؛ پیوند اعمال نمی‌شود"
              }
              className={`flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${
                broken
                  ? "border-app-warning/60 bg-app-warning/10 text-app-warning"
                  : openMark === i
                    ? "border-app-primary bg-app-primary-tint text-app-primary-strong"
                    : "border-app-line bg-app-bg text-app-muted hover:border-app-primary-soft"
              }`}
            >
              <span aria-hidden>
                {m.href ? "🔗" : ""}
                {m.strong ? "B" : ""}
              </span>
              <span className="max-w-36 truncate">{m.text}</span>
              {broken && <span aria-hidden>!</span>}
            </button>
          );
        })}
      </div>

      {openMark !== null && line.marks[openMark] && (
        <MarkEditor
          mark={line.marks[openMark]}
          found={markFound(line, line.marks[openMark])}
          onChange={(patch) => setMark(openMark, patch)}
          onDrop={() => dropMark(openMark)}
        />
      )}

      {hint && (
        <p className="mt-1 rounded-md bg-app-bg px-2 py-1 text-[10px] leading-5 text-app-warning" role="status">
          {hint}
        </p>
      )}
    </div>
  );
}

/** ویرایشِ یک نشانه: عبارتِ نمایشی، نشانی، و برداشتنِ پیوند/برجسته */
function MarkEditor({
  mark,
  found,
  onChange,
  onDrop,
}: {
  mark: { text: string; href?: string; strong?: boolean };
  found: boolean;
  onChange: (patch: Partial<{ text: string; href: string; strong: boolean }>) => void;
  onDrop: () => void;
}) {
  const unsafe = Boolean(mark.href) && !isSafeHref(mark.href ?? "");
  const isLink = mark.href !== undefined;

  return (
    <div className="mt-1 space-y-1.5 rounded-lg border border-app-line bg-app-bg p-2">
      <label className="block text-[10px] font-bold text-app-muted">
        عبارتِ نمایشی
        <input
          type="text"
          value={mark.text}
          onChange={(e) => onChange({ text: e.target.value })}
          className={inputCls}
        />
      </label>

      {isLink && (
        <label className="block text-[10px] font-bold text-app-muted">
          نشانی پیوند
          <input
            type="text"
            dir="ltr"
            value={mark.href ?? ""}
            placeholder="/returns یا https://… یا tel:+98…"
            // پیوندِ تازه‌ساخته: فوکوس مستقیم روی نشانی می‌نشیند تا مدیر همان‌جا بنویسد
            autoFocus={(mark.href ?? "") === ""}
            onChange={(e) => onChange({ href: e.target.value })}
            className={`${inputCls} text-start`}
          />
        </label>
      )}

      {unsafe && (
        <p className="text-[10px] leading-5 text-app-error">
          این نشانی مجاز نیست؛ با / یا https:// یا tel: و mailto: شروع کن — وگرنه سایت پیوندش نمی‌کند.
        </p>
      )}
      {!found && (
        <p className="text-[10px] leading-5 text-app-warning">
          این عبارت در متنِ خط نیست. یا عبارت را با متن یکی کن، یا نشانه را بردار.
        </p>
      )}

      <div className="flex flex-wrap gap-1">
        {isLink && (
          <button
            type="button"
            onClick={() => {
              // پیوند برود ولی اگر برجسته است، برجستگی بماند
              if (mark.strong) onChange({ href: undefined });
              else onDrop();
            }}
            className={miniBtn}
          >
            برداشتن پیوند
          </button>
        )}
        {mark.strong && (
          <button
            type="button"
            onClick={() => {
              if (isLink) onChange({ strong: false });
              else onDrop();
            }}
            className={miniBtn}
          >
            برداشتن برجسته
          </button>
        )}
        {!markEffective(mark) && (
          <button type="button" onClick={onDrop} className={`${miniBtn} text-app-error`}>
            حذف نشانه
          </button>
        )}
      </div>
    </div>
  );
}
