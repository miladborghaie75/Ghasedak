import { cn } from "@/lib/cn";

export interface ChipProps {
  selected?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

/** چیپ انتخابی — حداقل ۴۴px ارتفاع برای لمس */
export function Chip({
  selected = false,
  onClick,
  children,
  className,
  disabled,
}: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors duration-150",
        selected
          ? "border-primary-strong bg-primary-soft text-primary-strong"
          : "border-line bg-surface text-ink hover:border-primary hover:bg-primary-tint",
        disabled && "opacity-45",
        className,
      )}
    >
      {children}
    </button>
  );
}
