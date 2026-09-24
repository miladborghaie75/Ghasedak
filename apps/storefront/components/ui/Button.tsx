import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "icon" | "sticky";
type Size = "sm" | "md" | "lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** حالت در حال پردازش — aria-busy و غیرفعال */
  loading?: boolean;
}

const base =
  "inline-flex select-none items-center justify-center gap-2 rounded-full font-medium transition-[box-shadow,background-color,transform,opacity] duration-150 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]";

const variants: Record<Variant, string> = {
  primary:
    "bg-primary text-on-accent shadow-clay-1 hover:shadow-clay-2 hover:bg-primary-press",
  secondary:
    "bg-surface text-primary-strong border border-line shadow-clay-1 hover:shadow-clay-2 hover:bg-primary-tint",
  ghost: "text-primary-strong hover:bg-primary-tint",
  icon: "text-muted hover:bg-primary-tint hover:text-primary-strong",
  sticky:
    "bg-plum text-on-accent shadow-clay-2 hover:bg-plum/90 active:scale-[0.98]",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-[13px]",
  md: "h-11 px-5 text-sm",
  lg: "h-13 px-7 text-[15px]",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  disabled,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(base, variants[variant], sizes[size], className)}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}
