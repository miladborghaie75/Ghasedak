"use client";

import { useEffect, useRef, useState } from "react";
import { ART_KINDS, ART_FRAME_DEFAULT_COLORS, ArtPlaque, isArtFrameColor } from "@ghasedak/blocks";
import type { CmsBlockType, CmsField, CmsItemField } from "@ghasedak/blocks";
import { moveItem } from "@/lib/reorder";

/**
 * فرم تنظیمات بلوک — کاملاً داده‌محور.
 *
 * هیچ چیزی دربارهٔ بلوک‌های خاص اینجا نمی‌داند؛ فقط `CmsField[]` را
 * می‌خواند و کنترل می‌سازد. به این ترتیب افزودن فیلد جدید به یک بلوک
 * فقط در `packages/contracts` لازم است و این فرم خودکار آن را می‌بیند.
 */

export type RowValue = Record<string, string>;

const inputCls =
  "mt-1 block w-full rounded-xl border border-app-line bg-app-bg px-3 py-2 text-[13px] text-app-ink outline-none focus:border-app-primary-soft";

function fieldVisible(field: CmsField, blockType: string): boolean {
  if (!field.onlyFor || field.onlyFor.length === 0) return true;
  return field.onlyFor.includes(blockType as CmsBlockType);
}

function coerce(field: CmsField, raw: string): string | number | boolean {
  if (field.type === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return field.min ?? 0;
    return Math.min(Math.max(n, field.min ?? -Infinity), field.max ?? Infinity);
  }
  if (field.type === "boolean") return raw === "on" || raw === "true";
  return raw;
}

function currentValue(field: CmsField, value: unknown): string | number | boolean {
  const v = value as never;
  if (field.type === "number") return typeof v === "number" ? v : (field.min ?? 0);
  if (field.type === "boolean") return v === true;
  return typeof v === "string" ? v : "";
}

export default function FieldEditor({
  fields,
  props,
  blockType,
  highlightKey,
  onChange,
}: {
  fields: CmsField[];
  props: Record<string, unknown>;
  blockType: string;
  /**
   * کلید فیلدی که کاربر روی خود صفحه انتخاب کرده — تا فرم اسکرول شود
   * و آن فیلد با یک حاشیهٔ رنگی «فعال» دیده شود.
   */
  highlightKey?: string | null;
  onChange: (key: string, value: unknown) => void;
}) {
  const visible = fields.filter((f) => fieldVisible(f, blockType));
  const rootRef = useRef<HTMLDivElement>(null);

  // اسکرول تا فیلد انتخاب‌شده روی صفحه
  useEffect(() => {
    if (!highlightKey) return;
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-field-key="${highlightKey}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [highlightKey]);

  return (
    <div ref={rootRef} className="space-y-4">
      {visible.map((f) => (
        <div
          key={f.key}
          data-field-key={f.key}
          className={
            highlightKey === f.key ? "rounded-xl bg-app-primary-tint/60 p-2 -m-2" : undefined
          }
        >
          <Label field={f} value={props[f.key]} />

          {f.type === "textarea" && (
            <textarea
              rows={4}
              value={String(currentValue(f, props[f.key]) ?? "")}
              placeholder={f.placeholder}
              onChange={(e) => onChange(f.key, coerce(f, e.target.value))}
              className={inputCls}
            />
          )}

          {f.type === "text" && (
            <input
              type="text"
              value={String(currentValue(f, props[f.key]) ?? "")}
              placeholder={f.placeholder}
              onChange={(e) => onChange(f.key, coerce(f, e.target.value))}
              className={inputCls}
            />
          )}

          {f.type === "link" && (
            <input
              type="text"
              dir="ltr"
              value={String(currentValue(f, props[f.key]) ?? "")}
              placeholder={f.placeholder ?? "/path"}
              onChange={(e) => onChange(f.key, coerce(f, e.target.value))}
              className={`${inputCls} text-start`}
            />
          )}

          {f.type === "image" && (
            <ImageField
              value={props[f.key]}
              onChange={(v) => onChange(f.key, coerce(f, v))}
            />
          )}

          {f.type === "number" && (
            <input
              type="number"
              dir="ltr"
              min={f.min}
              max={f.max}
              step={f.step ?? 1}
              value={Number(currentValue(f, props[f.key])) || 0}
              onChange={(e) => onChange(f.key, coerce(f, e.target.value))}
              className={`${inputCls} text-start`}
            />
          )}

          {f.type === "boolean" && (
            <label className="mt-1 flex items-center gap-2 text-[13px] text-app-ink">
              <input
                type="checkbox"
                checked={props[f.key] === true}
                onChange={(e) => onChange(f.key, e.target.checked)}
                className="size-4 accent-[var(--app-primary)]"
              />
              فعال
            </label>
          )}

          {f.type === "select" && (
            <select
              value={String(currentValue(f, props[f.key]) ?? "")}
              onChange={(e) => onChange(f.key, coerce(f, e.target.value))}
              className={inputCls}
            >
              {(f.options ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}

          {f.type === "list" && (
            <ListEditor field={f} value={props[f.key]} onChange={(v) => onChange(f.key, v)} />
          )}

          {f.help && <p className="mt-1 text-[11px] leading-5 text-app-muted">{f.help}</p>}
        </div>
      ))}
    </div>
  );
}

/**
 * فیلد تصویر — آدرس دستی **یا** انتخاب از کتابخانهٔ رسانه.
 *
 * چرا انتخاب‌گر لازم بود: تا پیش از این باید آدرس عکس را دستی تایپ می‌کردی،
 * یعنی عملاً هیچ‌کس عکس واقعی نمی‌گذاشت. اکنون یک کلیک روی تصویر، آدرس
 * `/api/media/<key>` را می‌نویسد — همان شکلی که فروشگاه سرو می‌کند.
 */
type MediaItem = {
  id: string;
  url: string;
  kind: string;
  mime: string;
  width: number | null;
  height: number | null;
  alt: string | null;
  title: string | null;
};

function ImageField({ value, onChange }: { value: unknown; onChange: (v: string) => void }) {
  const url = typeof value === "string" ? value : "";
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || items !== null) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/admin/capabilities/media");
        const body = (await res.json().catch(() => null)) as { items?: MediaItem[] } | null;
        if (!alive) return;
        if (!res.ok) {
          setError("فهرست رسانه در دسترس نیست؛ آدرس عکس را دستی وارد کن.");
          setItems([]);
          return;
        }
        setItems((body?.items ?? []).filter((m) => m.kind === "image"));
      } catch {
        if (alive) {
          setError("شبکه در دسترس نیست؛ آدرس عکس را دستی وارد کن.");
          setItems([]);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, items]);

  return (
    <div className="mt-1">
      <input
        type="text"
        dir="ltr"
        value={url}
        placeholder="/api/media/… یا https://…"
        onChange={(e) => onChange(e.target.value)}
        className={`${inputCls} text-start`}
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg border border-app-primary-soft px-2.5 py-1 text-[11px] font-bold text-app-primary-strong hover:bg-app-primary-tint"
        >
          {open ? "بستن رسانه" : "انتخاب از رسانه"}
        </button>
        {url !== "" && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="rounded-lg border border-app-line px-2.5 py-1 text-[11px] font-bold text-app-muted hover:text-app-error"
          >
            برداشتن عکس
          </button>
        )}
        <a
          href="/media"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] font-bold text-app-muted underline decoration-dotted underline-offset-2"
        >
          افزودن عکس در کتابخانه ↗
        </a>
      </div>

      {url !== "" && (
        <div className="mt-2 overflow-hidden rounded-xl border border-app-line">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="h-24 w-full object-cover" />
        </div>
      )}

      {open && (
        <div className="mt-2 rounded-xl border border-app-line bg-app-bg/60 p-2">
          {items === null && <p className="py-3 text-center text-[11px] text-app-muted">در حال خواندن رسانه…</p>}
          {error && <p className="py-1 text-[11px] text-app-error">{error}</p>}
          {items !== null && items.length === 0 && !error && (
            <p className="py-2 text-center text-[11px] leading-5 text-app-muted">
              هنوز عکسی در کتابخانه نیست. از «افزودن عکس در کتابخانه» یکی بگذار.
            </p>
          )}
          {items !== null && items.length > 0 && (
            <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto">
              {items.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onChange(m.url);
                    setOpen(false);
                  }}
                  className="overflow-hidden rounded-lg border border-app-line bg-app-surface text-start hover:border-app-primary-soft"
                  title={m.title ?? m.alt ?? m.url}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.url} alt={m.alt ?? ""} className="h-16 w-full object-cover" />
                  <span className="block truncate px-1.5 py-1 text-[9px] text-app-muted">
                    {m.width && m.height ? `${m.width}×${m.height}` : m.mime}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Label({ field, value }: { field: CmsField; value: unknown }) {
  const filled =
    field.type === "list" ? Array.isArray(value) && value.length > 0 : value !== "" && value != null;
  return (
    <span className="flex items-baseline justify-between gap-2 text-[11px] font-bold text-app-muted">
      <span>{field.label}</span>
      {!filled && <span className="text-[10px] font-normal text-app-muted/70">پیش‌فرض</span>}
    </span>
  );
}

/** ویرایشگر لیستی (آیتم‌های تکرارشونده مثل مزیت‌ها یا پرسش‌ها) */
function ListEditor({
  field,
  value,
  onChange,
}: {
  field: CmsField;
  value: unknown;
  onChange: (rows: Array<Record<string, string>>) => void;
}) {
  const rows: Array<Record<string, string>> = Array.isArray(value)
    ? (value as Array<Record<string, unknown>>).map((r) => {
        const o: Record<string, string> = {};
        for (const [k, v] of Object.entries(r ?? {})) o[k] = typeof v === "string" ? v : String(v ?? "");
        return o;
      })
    : [];
  const itemFields: CmsItemField[] = field.itemFields ?? [{ key: "text", label: "متن", type: "text" }];
  /** ستونِ پیش‌نمایش آرت — در سربرگ سطر نشان داده می‌شود، نه در بدنهٔ آن */
  const artField = itemFields.find((f) => f.type === "art");
  const bodyFields = itemFields.filter((f) => f.type !== "art");
  /** تعداد سطرها ثابت است؟ (قفسهٔ فرم‌ها — سطری کم و زیاد نمی‌شود) */
  const fixed = field.listFixed === true;

  /**
   * کشیدن‌و‌رهاکردن — فقط از دستهٔ همان سطر.
   *
   * چرا کلِ سطر قابلِ‌کشیدن نیست؟ چون داخلِ هر سطر ورودیِ متن و انتخابگرِ رنگ
   * هست؛ اگر خودِ سطر draggable باشد، انتخابِ متن و کلیکِ کنترل‌ها با drag قاطی
   * می‌شود. پس فقط «دسته» کشیده می‌شود و دکمه‌های ↑/↓ سرِ جایشان می‌مانند —
   * نه به‌عنوان جایگزین، بلکه برای صفحه‌کلید، ماوسِ دقیق و کسانی که کشیدن
   * برایشان سخت است. هر دو مسیر از `moveItem` رد می‌شوند، پس یک نتیجه دارند.
   */
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [announce, setAnnounce] = useState("");
  /**
   * مرجعِ همگامِ سطرِ درحال‌کشیدن.
   *
   * چرا هم ref و هم state؟ state برای رنگ و هایلایت است، ولی درگیرِ زمان‌بندیِ
   * رندر است: اگر مرورگر `drop` را پیش از رندرِ بعدی بفرستد (کشیدنِ خیلی سریع
   * یا ماوسِ برنامه‌ای)، هندلر مقدارِ کهنه می‌دید و رهاکردن بی‌اثر می‌شد.
   * مرجع در همان `dragstart` نوشته می‌شود، پس همیشه تازه است.
   */
  const dragFromRef = useRef<number | null>(null);

  /**
   * فوکوس پس از جابه‌جایی با دکمه‌ها.
   *
   * چرا لازم است: سطرها با ایندکس کلید می‌خورند، پس بعد از جابه‌جایی همان
   * دکمه‌ای که فوکوس دارد به سطرِ تازه‌ای تعلق می‌گیرد؛ زدنِ دوبارهٔ ↓ سطر را
   * برمی‌گرداند (رفت‌و‌برگشت) نه اینکه پایین‌تر ببرد. اینجا فوکوس را روی همان
   * سطرِ جابه‌جاشده می‌نشانیم، پس چند بار ↓ واقعاً سطر را پایین می‌برد.
   */
  const rowEls = useRef<Array<HTMLDivElement | null>>([]);
  const [focusAfterMove, setFocusAfterMove] = useState<{ idx: number; dir: -1 | 1 } | null>(null);

  useEffect(() => {
    if (!focusAfterMove) return;
    const { idx, dir } = focusAfterMove;
    const row = rowEls.current[idx];
    const primary = row?.querySelector<HTMLButtonElement>(`button[data-move="${dir}"]`);
    const fallback = row?.querySelector<HTMLButtonElement>(`button[data-move="${-dir}"]`);
    // اگر سطر به انتها رسیده، همان دکمه غیرفعال است؛ فوکوس را از دست نمی‌دهیم
    (primary && !primary.disabled ? primary : fallback)?.focus();
    setFocusAfterMove(null);
  }, [focusAfterMove]);

  /** نامِ خوانا برای اعلام — نامِ فرم، نه شمارهٔ خامِ ردیف */
  const labelAt = (idx: number) => {
    const kind = artField ? (rows[idx]?.[artField.key] ?? "") : "";
    const name = artField?.options?.find((o) => o.value === kind)?.label;
    return name || `سطر ${(idx + 1).toLocaleString("fa-IR")}`;
  };

  const resetDrag = () => {
    dragFromRef.current = null;
    setDragFrom(null);
    setOverIdx(null);
  };

  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return;
    onChange(moveItem(rows, from, to));
    // کشیدن خودش هیچ صدایی ندارد؛ این پیام همان چیزی است که صفحه‌خوان می‌شنود
    setAnnounce(`${labelAt(from)} به جایگاه ${(to + 1).toLocaleString("fa-IR")} رفت`);
  };

  const setRow = (idx: number, key: string, v: string) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, [key]: v } : r));
    onChange(next);
  };
  const addRow = () => {
    const blank: Record<string, string> = {};
    for (const it of itemFields) blank[it.key] = "";
    onChange([...rows, blank]);
  };
  const removeRow = (idx: number) => onChange(rows.filter((_, i) => i !== idx));
  /** دکمه‌ها هم از همان مسیرِ کشیدن می‌روند تا دو رفتار نداشته باشیم */
  const move = (idx: number, dir: -1 | 1) => {
    const to = idx + dir;
    if (to < 0 || to >= rows.length) return;
    reorder(idx, to);
    setFocusAfterMove({ idx: to, dir });
  };

  return (
    <div className="mt-1 space-y-2">
      {rows.map((row, idx) => (
        <div
          key={idx}
          ref={(el) => {
            rowEls.current[idx] = el;
          }}
          onDragOver={(e) => {
            if (dragFromRef.current === null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (overIdx !== idx) setOverIdx(idx);
          }}
          onDragEnter={(e) => {
            if (dragFromRef.current === null) return;
            e.preventDefault();
            setOverIdx(idx);
          }}
          onDragLeave={(e) => {
            if (dragFromRef.current === null) return;
            // اگر فقط بینِ فرزندانِ همین سطر جابه‌جا شده، هایلایت را نبر
            const next = e.relatedTarget as Node | null;
            if (next && e.currentTarget.contains(next)) return;
            setOverIdx((cur) => (cur === idx ? null : cur));
          }}
          onDrop={(e) => {
            const from = dragFromRef.current;
            if (from === null) return;
            e.preventDefault();
            reorder(from, idx);
            resetDrag();
          }}
          className={`rounded-xl border p-2 transition-colors ${
            dragFrom === idx
              ? "border-dashed border-app-line bg-app-bg/40 opacity-50"
              : overIdx === idx && dragFrom !== null
                ? "border-app-primary-soft bg-app-primary-tint/50 ring-2 ring-app-primary-soft/40"
                : "border-app-line bg-app-bg/60"
          }`}
        >
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              {rows.length > 1 && (
                <span
                  draggable
                  onDragStart={(e) => {
                    dragFromRef.current = idx;
                    setDragFrom(idx);
                    e.dataTransfer.effectAllowed = "move";
                    // بدونِ setData بعضی مرورگرها drag را شروع نمی‌کنند
                    e.dataTransfer.setData("text/plain", String(idx));
                  }}
                  onDragEnd={resetDrag}
                  aria-hidden
                  title="بکش و رها کن تا جای این ردیف عوض شود"
                  className="flex cursor-grab select-none items-center rounded px-1 py-1 text-app-muted transition-colors hover:bg-app-primary-tint hover:text-app-primary-strong active:cursor-grabbing"
                >
                  {/* شش نقطهٔ دسته‌گیر — بی‌وابسته به فونت، تا در هر مرورگری «قابل کشیدن» خوانده شود */}
                  <svg viewBox="0 0 10 16" aria-hidden className="size-2.5">
                    {[3, 8, 13].map((cy) =>
                      [0, 6].map((cx) => (
                        <circle key={`${cx}-${cy}`} cx={cx + 2} cy={cy} r={1.4} fill="currentColor" />
                      )),
                    )}
                  </svg>
                </span>
              )}
              <span className="text-[10px] font-bold text-app-muted">#{idx + 1}</span>
              {artField && <ArtThumb item={artField} row={row} itemFields={itemFields} />}
            </span>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                data-move={-1}
                onClick={() => move(idx, -1)}
                disabled={idx === 0}
                className="rounded border border-app-line px-1.5 text-[10px] disabled:opacity-30"
                title="بالا"
                aria-label="یک جایگاه بالاتر"
              >
                ↑
              </button>
              <button
                type="button"
                data-move={1}
                onClick={() => move(idx, 1)}
                disabled={idx === rows.length - 1}
                className="rounded border border-app-line px-1.5 text-[10px] disabled:opacity-30"
                title="پایین"
                aria-label="یک جایگاه پایین‌تر"
              >
                ↓
              </button>
              {!fixed && (
                <button
                  type="button"
                  onClick={() => removeRow(idx)}
                  className="rounded border border-app-line px-1.5 text-[10px] text-app-error"
                  title="حذف"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            {bodyFields.map((it) =>
              it.type === "textarea" ? (
                <textarea
                  key={it.key}
                  rows={2}
                  placeholder={it.placeholder ?? it.label}
                  value={row[it.key] ?? ""}
                  onChange={(e) => setRow(idx, it.key, e.target.value)}
                  className="block w-full rounded-lg border border-app-line bg-app-surface px-2.5 py-1.5 text-[12px] text-app-ink outline-none focus:border-app-primary-soft"
                />
              ) : it.type === "swatch" ? (
                <SwatchRow
                  key={it.key}
                  item={it}
                  effective={effectiveSwatch(it, artField, row)}
                  onChange={(v) => setRow(idx, it.key, v)}
                />
              ) : (
                <input
                  key={it.key}
                  type="text"
                  placeholder={it.placeholder ?? it.label}
                  maxLength={it.maxLength}
                  value={row[it.key] ?? ""}
                  onChange={(e) => setRow(idx, it.key, e.target.value)}
                  className="block w-full rounded-lg border border-app-line bg-app-surface px-2.5 py-1.5 text-[12px] text-app-ink outline-none focus:border-app-primary-soft"
                />
              ),
            )}
          </div>
        </div>
      ))}
      {!fixed && (
        <button
          type="button"
          onClick={addRow}
          className="w-full rounded-xl border border-dashed border-app-line py-2 text-[11px] font-bold text-app-primary-strong hover:bg-app-primary-tint"
        >
          + افزودن مورد
        </button>
      )}
      {/* اعلامِ تغییر برای صفحه‌خوان — کشیدن صدا ندارد، این گره صدا می‌شود */}
      <span role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>
    </div>
  );
}

/**
 * رنگِ مؤثرِ قاب — همان چیزی که سایت رندر می‌کند.
 *
 * اگر مدیر برای قابی رنگی انتخاب نکرده باشد (یا مقدارش خارج از پالت بوده و
 * API آن را دور ریخته)، قرارداد رنگ پیش‌فرضِ همان فرم را می‌گذارد. پنل باید
 * دقیقاً همان را «انتخاب‌شده» نشان دهد — وگرنه مدیر رنگی می‌بیند که سایت
 * رنگی دیگر نشان می‌دهد و به پنل اعتماد می‌کند بی‌جهت.
 */
function effectiveSwatch(
  item: CmsItemField,
  artField: CmsItemField | undefined,
  row: Record<string, string>,
): string {
  const v = row[item.key] ?? "";
  if (isArtFrameColor(v)) return v;
  const kind = artField ? (row[artField.key] ?? "") : "";
  const fallback = ART_FRAME_DEFAULT_COLORS[kind as keyof typeof ART_FRAME_DEFAULT_COLORS];
  return fallback ?? "";
}

/**
 * انتخابگر رنگ — فقط رنگ‌های خودِ پالت برند.
 *
 * چرا رنگ آزاد ندارد؟ رنگ قاب‌ها بخشی از زبان بصری برند است؛ hex دلخواه یعنی
 * قفسه‌ای که دیگر شبیه خودش نیست. اینجا فقط توکن‌های تعریف‌شدهٔ برند
 * پیشنهاد می‌شوند و همان توکن‌ها در سایت رندر می‌شوند.
 */
function SwatchRow({
  item,
  effective,
  onChange,
}: {
  item: CmsItemField;
  /** رنگی که واقعاً رندر می‌شود — ممکن است با مقدار ذخیره‌شده فرق کند */
  effective: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={item.label}>
      {(item.options ?? []).map((o) => {
        const active = effective === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            title={o.label}
            aria-label={o.label}
            aria-pressed={active}
            className={`relative size-7 rounded-full border transition-transform ${
              active
                ? "border-app-primary-strong ring-2 ring-app-primary-strong/45 ring-offset-2 ring-offset-app-bg"
                : "border-app-line hover:scale-105"
            }`}
            style={{ background: o.cssVar ?? "transparent" }}
          >
            {active && (
              <span
                aria-hidden
                className="absolute -bottom-0.5 -start-0.5 flex size-3.5 items-center justify-center rounded-full border border-app-line bg-app-surface text-[8px] font-black text-app-primary-strong"
              >
                ✓
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * بندانگشتی آرتِ همان قاب — همان کامپوننتی که سایت رندر می‌کند.
 *
 * چون پیش‌نمایش از خودِ `ArtPlaque` می‌آید، آنچه مدیر اینجا می‌بیند همان
 * چیزی است که در سایت می‌نشیند؛ نه یک تصویرِ تقریبیِ دیگر.
 */
function ArtThumb({
  item,
  row,
  itemFields,
}: {
  item: CmsItemField;
  row: Record<string, string>;
  itemFields: CmsItemField[];
}) {
  const kind = row[item.key] ?? "";
  if (!ART_KINDS.includes(kind as (typeof ART_KINDS)[number])) return null;
  const colorField = item.colorFrom ? itemFields.find((f) => f.key === item.colorFrom) : undefined;
  const colorOption = colorField
    ? colorField.options?.find((o) => o.value === effectiveSwatch(colorField, item, row))
    : undefined;
  const name = item.options?.find((o) => o.value === kind)?.label ?? "";
  return (
    <span className="flex min-w-0 items-center gap-2">
      <ArtPlaque
        kind={kind as (typeof ART_KINDS)[number]}
        color={colorOption?.cssVar ?? "var(--color-primary)"}
        label={`آرت ${name}`}
        mark={false}
        className="h-10 w-8 shrink-0"
      />
      <span className="truncate text-[11px] font-bold text-app-ink">{name}</span>
    </span>
  );
}
