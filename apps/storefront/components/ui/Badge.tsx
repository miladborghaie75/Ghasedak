import { cn } from "@/lib/cn";

type BadgeKind = "discount" | "new" | "soldout";

export function Badge({
  kind,
  label,
  className,
}: {
  kind: BadgeKind;
  label: string;
  className?: string;
}) {
  const styles: Record<BadgeKind, string> = {
    discount: "bg-plum text-white",
    new: "bg-primary-soft text-primary-strong",
    soldout: "bg-surface text-muted border border-line",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold",
        styles[kind],
        className,
      )}
    >
      {label}
    </span>
  );
}
