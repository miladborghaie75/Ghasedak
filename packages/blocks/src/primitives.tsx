import Link from "next/link";
import { clsx } from "clsx";
import type { CmsProduct } from "./types";

/**
 * پریماینده‌های بصری بلوک‌ها.
 *
 * همه‌چیز روی توکن‌های `app-*` سوار است تا در فروشگاه و در بومِ ادمین
 * دقیقاً یکسان دیده شود. هیچ رنگ هاردکدی اینجا وجود ندارد.
 */

export function SectionShell({
  children,
  className,
  id,
  as: Tag = "section",
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
  as?: "section" | "div" | "header";
}) {
  return (
    <Tag id={id} className={clsx("mx-auto w-full max-w-7xl px-3 sm:px-4", className)}>
      {children}
    </Tag>
  );
}

export function SectionTitle({
  title,
  subtitle,
  center,
}: {
  title?: string;
  subtitle?: string;
  center?: boolean;
}) {
  if (!title && !subtitle) return null;
  return (
    <div className={clsx("mb-5", center && "text-center")}>
      {title && (
        <h2 className="text-xl font-black text-ink sm:text-2xl" style={{ fontFamily: "var(--font-display)" }}>
          {title}
        </h2>
      )}
      {subtitle && <p className={clsx("mt-1 text-[13px] text-muted", center && "mx-auto max-w-xl")}>{subtitle}</p>}
    </div>
  );
}

export function CtaButton({
  href,
  children,
  variant = "primary",
  size = "md",
  className,
}: {
  href?: string;
  children: React.ReactNode;
  variant?: "primary" | "ghost" | "onDark";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = {
    sm: "h-9 px-4 text-[12px]",
    md: "h-11 px-5 text-[13px]",
    lg: "h-12 px-7 text-sm",
  } as const;
  const variants = {
    primary: "bg-app-primary text-app-on-accent hover:bg-app-primary-strong shadow-app-shadow-1",
    ghost: "border border-app-line bg-app-surface text-app-ink hover:border-app-primary-soft",
    onDark: "bg-app-surface text-app-ink hover:bg-app-bg",
  } as const;

  const cls = clsx(
    "inline-flex items-center justify-center rounded-full font-bold transition-colors",
    sizes[size],
    variants[variant],
    className,
  );
  if (!href) return <span className={cls}>{children}</span>;
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

/** کارت محصول — نسخهٔ بلوک‌ساز (سبک و مستقل از دیتامدل فروشگاه) */
export function ProductTile({ product }: { product: CmsProduct }) {
  const off =
    product.compareAt != null && product.compareAt > product.price
      ? Math.round((1 - product.price / product.compareAt) * 100)
      : 0;

  return (
    <Link
      href={`/p/${product.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-card border border-app-line bg-app-surface shadow-app-shadow-1 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-app-shadow-2"
    >
      <div className="relative flex aspect-4/5 items-center justify-center overflow-hidden bg-app-primary-tint">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt={product.name}
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <span className="font-display text-4xl text-app-primary-soft" aria-hidden>
            {product.name.slice(0, 1)}
          </span>
        )}
        {off > 0 && (
          <span className="absolute top-2 end-2 rounded-full bg-app-error px-2 py-0.5 text-[10px] font-bold text-white">
            ٪{off.toLocaleString("fa-IR")}
          </span>
        )}
        {!off && product.badge && (
          <span className="absolute top-2 end-2 rounded-full bg-app-primary px-2 py-0.5 text-[10px] font-bold text-app-on-accent">
            {product.badge}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <p className="line-clamp-2 text-[13px] font-bold leading-6 text-app-ink">{product.name}</p>
        <div className="mt-auto flex items-baseline gap-2 pt-2">
          <span className="text-[13px] font-black text-app-primary-strong tabular-nums">
            {product.price.toLocaleString("fa-IR")}
          </span>
          {off > 0 && product.compareAt != null && (
            <span className="text-[11px] text-app-muted line-through tabular-nums">
              {product.compareAt.toLocaleString("fa-IR")}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

/** حالت خالی صادقانه — به‌جای داده ساختگی */
export function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-card border border-dashed border-app-line bg-app-surface/60 p-6 text-center text-[13px] text-app-muted">
      {text}
    </div>
  );
}