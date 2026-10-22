"use client";

/**
 * کنترل مرتب‌سازی مشترک لیست‌ها (دسته، جستجو، …) — یک منبع برای UI سورت.
 * فقط پارامتر `sort` را در URL جایگزین می‌کند و بقیهٔ پارامترها (q، فیلترها)
 * را دست‌نخورده نگه می‌دارد؛ منطق مرتب‌سازی در سرور با sortV2 اعمال می‌شود
 * (RSC-friendly، مثل بقیهٔ نوارهای فیلتر).
 * گزینهٔ «جدیدترین» عمداً بدون پارامتر ذخیره می‌شود (پیش‌فرض = آدرس تمیز).
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";
import { SORT_LABELS, type SortKey } from "@/lib/sort";

export function SortSelect({ sort, className }: { sort: SortKey; className?: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const onChange = (next: SortKey) => {
    const sp = new URLSearchParams(params.toString());
    if (next === "newest") sp.delete("sort");
    else sp.set("sort", next);
    const qs = sp.toString();
    router.push(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  return (
    <label className={cn("flex shrink-0 items-center gap-1.5 text-[12px] text-muted", className)}>
      <span className="hidden sm:inline">مرتب‌سازی:</span>
      <select
        value={sort}
        onChange={(e) => onChange(e.target.value as SortKey)}
        aria-label="مرتب‌سازی نتایج"
        className="h-10 rounded-full border border-line bg-surface px-3 text-[12px] font-bold text-ink"
      >
        {Object.entries(SORT_LABELS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
}
