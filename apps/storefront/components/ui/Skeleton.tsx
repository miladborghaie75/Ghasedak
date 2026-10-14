import { cn } from "@/lib/cn";

/**
 * اسکلتون بارگذاری — همان زبان بصری clay: قاعده‌های گرد، پس‌زمینهٔ
 * tint بنفش و نبض ملایم. فقط توکن مصرف می‌کند تا در دو تم درست باشد.
 * صبرکردن را «ملایم و بی‌صدا» نشان می‌دهد؛ نه اسپینر، نه متن خشک.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-card bg-primary-soft/60", className)}
    />
  );
}

/** اسکلتون کارت محصول — هم‌قدِ ProductCard در گریدهای ۲/۴ ستونه */
export function ProductCardSkeleton() {
  return (
    <div className="rounded-card border border-line bg-surface p-3 shadow-clay-1">
      <Skeleton className="aspect-square w-full rounded-blob" />
      <Skeleton className="mt-3 h-3.5 w-3/4" />
      <Skeleton className="mt-2 h-3.5 w-1/2" />
      <div className="mt-3 flex items-center justify-between">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-5 w-20" />
      </div>
    </div>
  );
}

/** اسکلتون گرید محصولات — n کارت با همان گرید ProductCard */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div role="status" aria-label="در حال بارگذاری محصولات">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: count }, (_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
