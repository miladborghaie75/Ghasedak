import { Skeleton } from "@/components/ui/Skeleton";

/**
 * بارگذاری ریشهٔ فروشگاه (گام ۱۰) — اسکلتونِ درون لایهٔ layout؛ نه اسپینر،
 * نه متن خشک. همان زبان clay (کارت‌های گرد با tint بنفش و نبض ملایم) تا
 * کاربر احساس کند دنبالهٔ همان صفحه‌ای است که می‌شناخته. بخش‌های صفحه
 * خودشان loading خودشان را دارند؛ این فقط پوستهٔ اولیه است.
 */
export default function StorefrontLoading() {
  return (
    <div role="status" aria-label="در حال بارگذاری صفحه" className="mx-auto max-w-6xl px-4 py-10">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="mt-4 h-4 w-full max-w-2xl" />
      <div className="mt-10 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="rounded-card border border-line bg-surface p-3 shadow-clay-1">
            <Skeleton className="aspect-square w-full rounded-blob" />
            <Skeleton className="mt-3 h-3.5 w-3/4" />
            <Skeleton className="mt-2 h-3.5 w-1/2" />
            <div className="mt-3 flex items-center justify-between">
              <Skeleton className="h-9 w-9 rounded-full" />
              <Skeleton className="h-5 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
