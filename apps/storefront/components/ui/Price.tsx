import { cn } from "@/lib/cn";
import { faNum } from "@/lib/format";

interface PriceProps {
  price: number;
  compareAtPrice?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * قیمت واحد پروژه — ارقام فارسی، «تومان» همیشه ریزتر و کم‌رنگ‌تر.
 * تخفیف فقط وقتی salePrice واقعی وجود دارد رندر می‌شود (بند ۲۵).
 */
export function Price({
  price,
  compareAtPrice,
  size = "md",
  className,
}: PriceProps) {
  const hasDiscount =
    compareAtPrice != null && compareAtPrice > price;
  const percent = hasDiscount
    ? Math.round(((compareAtPrice - price) / compareAtPrice) * 100)
    : 0;

  const textSize = size === "lg" ? "text-xl" : size === "sm" ? "text-[15px]" : "text-lg";
  const unitSize = size === "lg" ? "text-xs" : "text-[11px]";

  return (
    <div
      className={cn("flex items-center gap-2", className)}
      dir="rtl"
      aria-label={
        hasDiscount
          ? `قیمت ${faNum(price)} تومان، قبل از تخفیف ${faNum(compareAtPrice)} تومان`
          : `قیمت ${faNum(price)} تومان`
      }
    >
      {hasDiscount && (
        <del className="text-xs text-muted tnum" aria-hidden>
          {faNum(compareAtPrice)}
        </del>
      )}
      <strong className={cn("tnum font-extrabold text-plum", textSize)}>
        {faNum(price)}
      </strong>
      <span className={cn("font-medium text-muted", unitSize)}>تومان</span>
      {hasDiscount && (
        <span className="rounded-full bg-plum px-2 py-0.5 text-[11px] font-bold text-white">
          {faNum(percent)}٪
        </span>
      )}
    </div>
  );
}
