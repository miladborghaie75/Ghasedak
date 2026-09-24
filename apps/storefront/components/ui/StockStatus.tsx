import { cn } from "@/lib/cn";
import { faNum } from "@/lib/format";

/**
 * وضعیت موجودی صادقانه — هیچ عدد جعلی تولید نمی‌شود؛ از stock واقعی می‌آید.
 */
export function StockStatus({
  stock,
  lowThreshold = 4,
  className,
}: {
  stock: number;
  lowThreshold?: number;
  className?: string;
}) {
  if (stock <= 0) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium text-muted", className)}>
        <span aria-hidden className="size-2 rounded-full bg-line" />
        ناموجود
      </span>
    );
  }
  if (stock <= lowThreshold) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium text-[#C98A2D]", className)}>
        <span aria-hidden className="size-2 rounded-full bg-[#C98A2D]" />
        تنها {faNum(stock)} عدد باقی مانده
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium text-[#2E9E6B]", className)}>
      <span aria-hidden className="size-2 rounded-full bg-[#2E9E6B]" />
      موجود
    </span>
  );
}
