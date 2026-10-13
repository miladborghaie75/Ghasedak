"use client";

import type { CmsBlockType, CmsField } from "@ghasedak/blocks";

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
  onChange,
}: {
  fields: CmsField[];
  props: Record<string, unknown>;
  blockType: string;
  onChange: (key: string, value: unknown) => void;
}) {
  const visible = fields.filter((f) => fieldVisible(f, blockType));

  return (
    <div className="space-y-4">
      {visible.map((f) => (
        <div key={f.key}>
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
            <div className="mt-1">
              <input
                type="text"
                dir="ltr"
                value={String(currentValue(f, props[f.key]) ?? "")}
                placeholder="/uploads/… یا https://…"
                onChange={(e) => onChange(f.key, coerce(f, e.target.value))}
                className={`${inputCls} text-start`}
              />
              {typeof props[f.key] === "string" && props[f.key] !== "" && (
                <div className="mt-2 overflow-hidden rounded-xl border border-app-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={String(props[f.key])} alt="" className="h-24 w-full object-cover" />
                </div>
              )}
            </div>
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
  const itemFields = field.itemFields ?? [{ key: "text", label: "متن", type: "text" as const }];

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
  const move = (idx: number, dir: -1 | 1) => {
    const t = idx + dir;
    if (t < 0 || t >= rows.length) return;
    const next = [...rows];
    [next[idx], next[t]] = [next[t], next[idx]];
    onChange(next);
  };

  return (
    <div className="mt-1 space-y-2">
      {rows.map((row, idx) => (
        <div key={idx} className="rounded-xl border border-app-line bg-app-bg/60 p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-bold text-app-muted">#{idx + 1}</span>
            <div className="flex gap-1">
              <button type="button" onClick={() => move(idx, -1)} className="rounded border border-app-line px-1.5 text-[10px]" title="بالا">↑</button>
              <button type="button" onClick={() => move(idx, 1)} className="rounded border border-app-line px-1.5 text-[10px]" title="پایین">↓</button>
              <button type="button" onClick={() => removeRow(idx)} className="rounded border border-app-line px-1.5 text-[10px] text-app-error" title="حذف">✕</button>
            </div>
          </div>
          <div className="space-y-1.5">
            {itemFields.map((it) =>
              it.type === "textarea" ? (
                <textarea
                  key={it.key}
                  rows={2}
                  placeholder={it.placeholder ?? it.label}
                  value={row[it.key] ?? ""}
                  onChange={(e) => setRow(idx, it.key, e.target.value)}
                  className="block w-full rounded-lg border border-app-line bg-app-surface px-2.5 py-1.5 text-[12px] text-app-ink outline-none focus:border-app-primary-soft"
                />
              ) : (
                <input
                  key={it.key}
                  type="text"
                  placeholder={it.placeholder ?? it.label}
                  value={row[it.key] ?? ""}
                  onChange={(e) => setRow(idx, it.key, e.target.value)}
                  className="block w-full rounded-lg border border-app-line bg-app-surface px-2.5 py-1.5 text-[12px] text-app-ink outline-none focus:border-app-primary-soft"
                />
              ),
            )}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        className="w-full rounded-xl border border-dashed border-app-line py-2 text-[11px] font-bold text-app-primary-strong hover:bg-app-primary-tint"
      >
        + افزودن مورد
      </button>
    </div>
  );
}