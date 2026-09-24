"use client";

/**
 * نوار فیلتر دسته — Client Component سبک که فقط URL را تغییر می‌دهد؛
 * منطق فیلتر/سورت در Server Component صفحه اعمال می‌شود (RSC-friendly).
 * فیلترها آگاه‌به‌دسته‌اند (بند ۱۹) و «نوع سوتین» فقط گروه‌بندی بصری است (بند ۱۷).
 * OR داخل یک اتریبیوت، AND بین اتریبیوت‌ها (بند ۱۸) — در applyFiltersV2.
 */
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState } from "react";
import { Chip } from "@/components/ui/Chip";
import { Sheet } from "@/components/ui/Sheet";
import { faNum, toEnDigits } from "@/lib/format";
import { cn } from "@/lib/cn";
import {
  getTerm,
  termsOf,
  type AttributeKey,
  type CategorySlug,
} from "@/lib/attributes";
import {
  filterOptionsFor,
  getAllProductsV2,
  getProductsByCategoryV2,
  type FilterStateV2,
} from "@/lib/catalog-repo";
import { SORT_LABELS, type SortKey } from "@/lib/sort";

const PARAMS: Record<string, string> = {
  size: "size",
  cup: "cup",
  underwire: "wire",
  padding: "pad",
  color: "color",
  material: "mat",
  brand: "brand",
};
const PRICE_PARAM = "max";
const SORT_PARAM = "sort";

/** اتریبیوت‌های آرایه‌ای فیلتر — برند هم در همین مدل است */
type ArrayFilterKey =
  | "size"
  | "cup"
  | "underwire"
  | "padding"
  | "color"
  | "material"
  | "brand";

/** پارس URL → FilterState (سمت کلاینت برای نمایش چیپ‌ها؛ پارس اصلی در سرور) */
export function parseClientFilters(sp: URLSearchParams): FilterStateV2 {
  const f: FilterStateV2 = {
    size: [], cup: [], underwire: [], padding: [], color: [], material: [], brand: [],
  };
  for (const [attr, param] of Object.entries(PARAMS)) {
    (f as unknown as Record<string, string[]>)[attr] = sp.getAll(param);
  }
  const max = sp.get(PRICE_PARAM);
  if (max) {
    const n = Number(toEnDigits(max));
    if (!Number.isNaN(n) && n > 0) f.priceMax = n;
  }
  return f;
}

function buildUrl(
  current: URLSearchParams,
  patch: Record<string, string[] | number | undefined>,
  nextSort?: SortKey,
): string {
  const sp = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(patch)) {
    const param = PARAMS[key] ?? key;
    sp.delete(param);
    if (Array.isArray(value)) value.forEach((v) => sp.append(param, v));
    else if (typeof value === "number") sp.set(param, String(value));
    else if (value !== undefined) sp.append(param, value);
  }
  if (nextSort) sp.set(SORT_PARAM, nextSort);
  const qs = sp.toString();
  return qs ? `?${qs}` : location.pathname;
}

interface BarProps {
  category: CategorySlug;
  filters: FilterStateV2;
  sort: SortKey;
}

export function CategoryFiltersBar({ category, filters, sort }: BarProps) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const pool = getProductsByCategoryV2(category);
  const options = filterOptionsFor(category, pool) as Record<ArrayFilterKey, string[]> & { brand?: string[] };

  const go = (
    patch: Record<string, string[] | number | undefined>,
    nextSort?: SortKey,
  ) => {
    router.push(`${pathname}${buildUrl(params, patch, nextSort)}`, { scroll: false });
  };

  const toggle = (attr: ArrayFilterKey, value: string) => {
    const cur = (filters[attr] as string[]) ?? [];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    go({ [attr]: next });
  };

  const activeAttrs = (["size", "cup", "underwire", "padding", "color", "material", "brand"] as ArrayFilterKey[]).filter(
    (a) => ((filters[a] as string[]) ?? []).length > 0,
  );
  const activeCount = activeAttrs.length + (filters.priceMax != null ? 1 : 0);

  const clearAll = () => {
    const sp = new URLSearchParams();
    if (params.get(SORT_PARAM)) sp.set(SORT_PARAM, params.get(SORT_PARAM)!);
    router.push(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  const chipLabel = (attr: ArrayFilterKey, id: string) => {
    if (attr === "cup") return `کاپ ${getTerm(id).label}`;
    if (attr === "underwire") return getTerm(id).label;
    return getTerm(id).label;
  };

  const groups: { attr: ArrayFilterKey; title: string; ids: string[]; visualGroup?: string }[] = [];
  // ترتیب: سایز، نوع سوتین (فنر/اسفنج/کاپ — گروه بصری بند ۱۷)، رنگ، جنس، برند
  const order: { attr: ArrayFilterKey; title: string; visualGroup?: string }[] = [
    { attr: "size", title: "سایز" },
    { attr: "underwire", title: "فنر", visualGroup: "نوع سوتین" },
    { attr: "padding", title: "اسفنج", visualGroup: "نوع سوتین" },
    { attr: "cup", title: "کاپ", visualGroup: "نوع سوتین" },
    { attr: "color", title: "رنگ" },
    { attr: "material", title: "جنس" },
    { attr: "brand", title: "برند" },
  ];
  for (const g of order) {
    const ids = options[g.attr];
    if (ids?.length) groups.push({ attr: g.attr, title: g.title, ids });
  }

  const filterBody = (
    <div className="flex flex-col gap-5">
      {groups.map((g, idx) => {
        const showGroupTitle =
          g.visualGroup && (idx === 0 || groups[idx - 1].visualGroup !== g.visualGroup);
        return (
          <div key={g.attr}>
            {showGroupTitle && (
              <p className="mb-2 border-b border-dashed border-line pb-1 text-[12px] font-bold text-primary-strong">
                {g.visualGroup}
              </p>
            )}
            <fieldset>
              <legend className="mb-2.5 text-[13px] font-extrabold text-ink">
                {g.title}
                {((filters[g.attr] as string[]) ?? []).length > 0 && (
                  <span className="ms-2 inline-flex min-w-5 items-center justify-center rounded-full bg-primary-soft px-1.5 text-[11px] font-bold text-primary-strong tnum">
                    {faNum(((filters[g.attr] as string[]) ?? []).length)}
                    <span className="sr-only"> انتخاب فعال</span>
                  </span>
                )}
              </legend>
              {g.attr === "color" ? (
                <div className="flex flex-wrap gap-2.5">
                  {g.ids.map((cid) => {
                    const t = getTerm(cid);
                    const sel = (filters.color as string[]).includes(cid);
                    return (
                      <button
                        key={cid}
                        type="button"
                        aria-pressed={sel}
                        aria-label={`رنگ ${t.label}`}
                        onClick={() => toggle("color", cid)}
                        className={cn(
                          "size-9 rounded-full border-2 transition-transform",
                          sel ? "border-primary-strong scale-110" : "border-line hover:scale-105",
                        )}
                        style={{ backgroundColor: t.hex }}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {g.ids.map((id) => {
                    const sel = ((filters[g.attr] as string[]) ?? []).includes(id);
                    return (
                      <Chip key={id} selected={sel} onClick={() => toggle(g.attr, id)}>
                        {chipLabel(g.attr, id)}
                      </Chip>
                    );
                  })}
                </div>
              )}
            </fieldset>
          </div>
        );
      })}

      {/* قیمت */}
      <fieldset>
        <legend className="mb-2.5 text-[13px] font-extrabold text-ink">حداکثر قیمت</legend>
        <div className="flex flex-wrap gap-2">
          {[200000, 400000, 600000, 800000].map((p) => (
            <Chip
              key={p}
              selected={filters.priceMax === p}
              onClick={() => go({ [PRICE_PARAM]: filters.priceMax === p ? undefined : p })}
            >
              تا {faNum(p)} تومان
            </Chip>
          ))}
        </div>
      </fieldset>
    </div>
  );

  return (
    <>
      {/* نوار چسبان: فیلتر + چیپ‌های فعال + سورت */}
      <div className="sticky top-24 z-30 mb-4 flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface/95 px-3 py-2.5 shadow-clay-1 backdrop-blur">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-haspopup="dialog"
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[13px] font-bold text-ink lg:hidden"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" />
          </svg>
          فیلترها
          {activeCount > 0 && (
            <span className="flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-white tnum">
              {faNum(activeCount)}
            </span>
          )}
        </button>

        {/* چیپ‌های فعال — حذف تک‌تک (بند ۲۰) */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {activeAttrs.flatMap((attr) =>
            ((filters[attr] as string[]) ?? []).map((id) => (
              <button
                key={`${attr}-${id}`}
                type="button"
                onClick={() => toggle(attr, id)}
                aria-label={`حذف فیلتر ${chipLabel(attr, id)}`}
                className="inline-flex h-8 items-center gap-1 rounded-full border border-primary/40 bg-primary-tint px-2.5 text-[12px] font-semibold text-primary-strong hover:bg-primary-soft"
              >
                {chipLabel(attr, id)}
                <span aria-hidden>×</span>
              </button>
            )),
          )}
          {filters.priceMax != null && (
            <button
              type="button"
              onClick={() => go({ [PRICE_PARAM]: undefined })}
              aria-label="حذف فیلتر قیمت"
              className="inline-flex h-8 items-center gap-1 rounded-full border border-primary/40 bg-primary-tint px-2.5 text-[12px] font-semibold text-primary-strong hover:bg-primary-soft"
            >
              تا {faNum(filters.priceMax)} تومان <span aria-hidden>×</span>
            </button>
          )}
          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex h-8 items-center rounded-full px-2.5 text-[12px] font-semibold text-muted hover:text-ink"
            >
              حذف همه فیلترها
            </button>
          )}
        </div>

        {/* سورت — بدون گزینه جعلی (بند ۲۱) */}
        <label className="ms-auto flex shrink-0 items-center gap-1.5 text-[12px] text-muted">
          <span className="hidden sm:inline">مرتب‌سازی:</span>
          <select
            value={sort}
            onChange={(e) => go({}, e.target.value as SortKey)}
            className="h-10 rounded-full border border-line bg-surface px-3 text-[12px] font-bold text-ink"
          >
            {Object.entries(SORT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Drawer فیلتر — موبایل؛ در دسکتاپ هم قابل باز شدن */}
      <Sheet open={drawerOpen} onClose={() => setDrawerOpen(false)} title="فیلترها">
        {filterBody}
        <div className="sticky bottom-0 -mx-4 -mb-2 border-t border-line bg-surface px-4 pb-3 pt-3">
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="h-12 w-full rounded-full bg-primary font-bold text-white shadow-clay-1"
          >
            اعمال فیلتر
          </button>
        </div>
      </Sheet>
    </>
  );
}
