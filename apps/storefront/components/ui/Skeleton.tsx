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

/**
 * اسکلتون کارت محصول — هم‌قد و هم‌ساختِ ProductCard (ردیف‌های ثابت:
 * تصویر ۱:۱، نام ۲خط، نوار امتیاز ۱۸px، سواچ ۱۶px، سایز ۱۶px، قیمت، دکمه)
 */
export function ProductCardSkeleton() {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-line bg-surface p-1.5">
      <Skeleton className="aspect-square w-full rounded-xl" />
      <div className="flex flex-1 flex-col items-center px-1.5 pb-2 pt-2 text-center">
        <Skeleton className="h-[44px] w-4/5" />
        <Skeleton className="mt-1 h-[18px] w-1/2" />
        <Skeleton className="mt-1.5 h-4 w-3/5" />
        <Skeleton className="mt-1 h-4 w-2/5" />
        <div className="mt-auto w-full pt-2">
          <Skeleton className="mx-auto h-5 w-1/3" />
          <Skeleton className="mt-2 h-10 w-full rounded-xl" />
        </div>
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
