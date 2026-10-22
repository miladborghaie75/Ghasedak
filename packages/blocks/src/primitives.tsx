import Link from "next/link";
import Image from "next/image";
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
  field,
  subtitleField,
}: {
  title?: string;
  subtitle?: string;
  center?: boolean;
  /**
   * نام فیلد در props بلوک — فقط برای ویرایش درجا در حالت پیش‌نمایش.
   * پل پیش‌نمایش با این نشانه می‌فهمد کدام متن را می‌تواند روی خود صفحه
   * ویرایش کند. در سایت منتشرشده هیچ اثری ندارد.
   */
  field?: string;
  subtitleField?: string;
}) {
  if (!title && !subtitle) return null;
  return (
    <div className={clsx("mb-5", center && "text-center")}>
      {title && (
        <h2
          className="text-xl font-black text-ink sm:text-2xl"
          style={{ fontFamily: "var(--font-display)" }}
          {...(field ? { "data-cms-field": field } : {})}
        >
          {title}
        </h2>
      )}
      {subtitle && (
        <p
          className={clsx("mt-1 text-[13px] text-muted", center && "mx-auto max-w-xl")}
          {...(subtitleField ? { "data-cms-field": subtitleField } : {})}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}

export function CtaButton({
  href,
  children,
  variant = "primary",
  size = "md",
  className,
  field,
}: {
  href?: string;
  children: React.ReactNode;
  variant?: "primary" | "ghost" | "onDark";
  size?: "sm" | "md" | "lg";
  className?: string;
  /** نام فیلد props — نشانهٔ ویرایش درجا در حالت پیش‌نمایش */
  field?: string;
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
  const marker = field ? { "data-cms-field": field } : {};
  if (!href) return <span className={cls} {...marker}>{children}</span>;
  return (
    <Link href={href} className={cls} {...marker}>
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
      {/*
       * قاب تصویر: عکس یا «قاب پاسپارتو».
       * کارت بی‌عکس دقیقاً همان زبان قاب هیرو (MediaFrame) را دارد: حاشیهٔ روشن،
       * صفحهٔ tint، و نشان قاصدک در مرکز — چون بلوک دادهٔ محصول فقط نام/قیمت دارد
       * و آرت دسته را نمی‌داند؛ پس نشان خودش «موضوع» است، نه حرف اول نام
       * (همهٔ بلوک‌ها یک حرف تکراری نشان می‌دادند و فقط نویز بود).
       */}
      <div className="relative flex aspect-4/5 items-center justify-center overflow-hidden bg-app-surface">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt={product.name}
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <>
            <span aria-hidden className="absolute inset-[2.2%] rounded-xl bg-app-primary-tint ring-1 ring-app-line/70" />
            <BrandMark className="pointer-events-none absolute inset-0 m-auto size-[44%] text-app-primary/20" />
          </>
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

/**
 * نشان برند — همان «قاصدک» لوگو، بدون پلاک بنفش تا در هر زمینه‌ای بنشیند.
 * رنگ از `currentColor` می‌آید تا در تم روشن/شب درست دیده شود.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={className} fill="none">
      <g stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
        <line x1="32" y1="32" x2="32" y2="15" />
        <line x1="32" y1="32" x2="18" y2="21" />
        <line x1="32" y1="32" x2="46" y2="21" />
        <line x1="32" y1="32" x2="15" y2="34" />
        <line x1="32" y1="32" x2="49" y2="34" />
        <line x1="32" y1="32" x2="21" y2="44" />
        <line x1="32" y1="32" x2="43" y2="44" />
        <path d="M32 40 C32 47 33 51 32 56" />
      </g>
      <g fill="currentColor">
        <circle cx="32" cy="13" r="3" />
        <circle cx="16" cy="19" r="3" />
        <circle cx="48" cy="19" r="3" />
        <circle cx="12" cy="35" r="3" />
        <circle cx="52" cy="35" r="3" />
        <circle cx="19" cy="46" r="3" />
        <circle cx="45" cy="46" r="3" />
      </g>
    </svg>
  );
}

/**
 * قاب تصویر — یک قاب تکی برای هیرو/بلوک‌های تصویری.
 *
 * دو حالت دارد و هر دو عمدی‌اند:
 *  ۱) عکس دارد → عکس با `object-cover` در نسبت ثابت بریده می‌شود (بدون کشیدگی)،
 *     `priority` برای LCP و `sizes` واقعی تا موبایل عکس کوچک بگیرد.
 *  ۲) عکس ندارد → **همان قاب** با نشان برند و حلقه‌های ملایم پر می‌شود.
 *     چرا نه جای خالی؟ چون قاب خالی به کاربر می‌گوید «سایت خراب است».
 *     متن راهنما فقط در حالت پیش‌نمایش پنل دیده می‌شود (`[data-cms-preview]`).
 *
 * نسبت ابعاد را مصرف‌کننده تعیین می‌کند (`aspect-…` در className)، چون در هیرو
 * عمودی و در بلوک متنی افقی است.
 */
export function MediaFrame({
  imageUrl,
  alt,
  focus = "center",
  className,
  sizes = "(min-width: 1024px) 44vw, 92vw",
  priority,
}: {
  imageUrl?: string;
  alt?: string;
  /** بخشی از تصویر که در قاب می‌ماند — برای عکس‌های عمودی */
  focus?: "center" | "top" | "bottom";
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  const focusCls =
    focus === "top" ? "object-top" : focus === "bottom" ? "object-bottom" : "object-center";

  return (
    <div
      className={clsx(
        // قاب روشن روی زمینهٔ بنفشِ هیرو — بدون این تفاوت رنگ، «قاب» دیده نمی‌شد
        "relative overflow-hidden rounded-blob bg-app-surface ring-1 ring-app-line shadow-app-shadow-2",
        className,
      )}
    >
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={alt ?? ""}
          fill
          priority={priority}
          sizes={sizes}
          className={clsx("object-cover", focusCls)}
        />
      ) : (
        <div className="absolute inset-0">
          {/*
           * حالت بدون عکس: «پاسپارتو» — قاب سفید، حاشیهٔ بنفشِ برند و نشان
           * بزرگ اما محو در مرکز. عمداً هیچ متن/آیکون «عکس بگذار» اینجا نیست؛
           * راهنما فقط در حالت پیش‌نمایش پنل ظاهر می‌شود.
           */}
          <div className="absolute inset-2.5 grid place-items-center rounded-[1.4rem] bg-app-primary-tint">
            <BrandMark className="size-24 text-app-primary/20 sm:size-28" />
          </div>
          <span
            data-cms-empty-hint=""
            className="absolute inset-x-4 bottom-4 hidden rounded-full bg-app-surface px-3 py-1.5 text-center text-[10px] font-bold text-app-muted ring-1 ring-app-line"
          >
            قاب عکس: از پنل کنار، «عکس قاب هیرو» را انتخاب کن
          </span>
        </div>
      )}
    </div>
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
