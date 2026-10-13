import Link from "next/link";
import Image from "next/image";
import { clsx } from "clsx";
import type { CmsBlockProps } from "../types";
import { pNum, pStr, pickProducts, pItems } from "../types";
import { CtaButton, EmptyHint, ProductTile, SectionShell, SectionTitle } from "../primitives";

/**
 * بلوک‌های از پیش ساخته‌شدهٔ صفحه‌ساز.
 *
 * هر تابع یک بلوک را رندر می‌کند و ورودی‌اش فقط `block` (props پاک‌شده)
 * و `data` (دادهٔ واقعی فروشگاه) است. نه‌یک HTML خام، نه dangerouslySetInnerHTML —
 * متن‌ها همیشه به‌صورت گرهٔ ریاکت رندر می‌شوند.
 */

/* ─────────────────────────── هیرو ─────────────────────────── */
export function HeroBlock({ block, data }: CmsBlockProps) {
  const p = block.props;
  const title = pStr(p, "title");
  const eyebrow = pStr(p, "eyebrow");
  const subtitle = pStr(p, "subtitle");
  const imageUrl = pStr(p, "imageUrl");
  const align = pStr(p, "align", "start") === "center" ? "center" : "start";
  const heights = { sm: "py-10 sm:py-12", md: "py-14 sm:py-20", lg: "py-20 sm:py-28" } as const;
  const h = heights[(pStr(p, "height", "md") as keyof typeof heights) ?? "md"] ?? heights.md;

  const hint = data.products.length === 0;

  return (
    <section
      className={clsx("relative overflow-hidden bg-app-primary-tint", h)}
      aria-label={title || "هیرو"}
    >
      {imageUrl && (
        // هیرو تصویر LCP است — priority + sizes کامل عرض
        <Image
          src={imageUrl}
          alt=""
          aria-hidden
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
      )}
      {imageUrl && <div className="absolute inset-0 bg-app-bg/70" aria-hidden />}

      <SectionShell className="relative">
        <div className={clsx(align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl")}>
          {eyebrow && (
            <p className="mb-2 text-[12px] font-bold text-app-primary-strong">{eyebrow}</p>
          )}
          {title && (
            <h1 className="text-3xl font-black leading-tight text-app-ink sm:text-5xl">{title}</h1>
          )}
          {subtitle && <p className="mt-3 text-sm leading-8 text-app-muted sm:text-base">{subtitle}</p>}

          <div className={clsx("mt-6 flex flex-wrap gap-3", align === "center" && "justify-center")}>
            {pStr(p, "ctaLabel") && <CtaButton href={pStr(p, "ctaHref")} size="lg">{pStr(p, "ctaLabel")}</CtaButton>}
            {pStr(p, "secondaryLabel") && (
              <CtaButton href={pStr(p, "secondaryHref")} variant="ghost" size="lg">
                {pStr(p, "secondaryLabel")}
              </CtaButton>
            )}
          </div>

          {hint && (
            <p className="mt-4 text-[11px] text-app-muted">
              (پیش‌نمایش — دادهٔ محصولات در دسترس نیست)
            </p>
          )}
        </div>
      </SectionShell>
    </section>
  );
}

/* ─────────────────────────── بنر ─────────────────────────── */
export function BannerBlock({ block }: CmsBlockProps) {
  const p = block.props;
  const tones = {
    primary: "bg-app-primary text-app-on-accent",
    dark: "bg-app-ink text-app-on-accent",
    soft: "bg-app-primary-tint text-app-ink",
  } as const;
  const tone = tones[(pStr(p, "tone", "primary") as keyof typeof tones) ?? "primary"] ?? tones.primary;
  const dark = tone !== tones.soft;

  return (
    <SectionShell className="mt-8">
      <div className={clsx("flex flex-wrap items-center justify-between gap-4 rounded-blob p-6 shadow-app-shadow-1 sm:p-9", tone)}>
        <div className="min-w-0">
          {pStr(p, "title") && (
            <h2 className="text-lg font-black sm:text-2xl">{pStr(p, "title")}</h2>
          )}
          {pStr(p, "subtitle") && (
            <p className={clsx("mt-1 text-[13px]", dark ? "opacity-90" : "text-app-muted")}>
              {pStr(p, "subtitle")}
            </p>
          )}
        </div>
        {pStr(p, "ctaLabel") && (
          <CtaButton href={pStr(p, "ctaHref")} variant={dark ? "onDark" : "primary"} size="md">
            {pStr(p, "ctaLabel")}
          </CtaButton>
        )}
      </div>
    </SectionShell>
  );
}

/* ─────────────────────── شبکه دسته‌بندی ─────────────────────── */
export function CategoryGridBlock({ block, data }: CmsBlockProps) {
  const p = block.props;
  const limit = pNum(p, "limit", 6);
  const cats = data.categories.slice(0, limit);

  return (
    <SectionShell className="mt-10">
      <SectionTitle title={pStr(p, "title", "دسته‌بندی‌ها")} />
      {cats.length === 0 ? (
        <EmptyHint text="هنوز دسته‌بندی‌ای برای نمایش وجود ندارد." />
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {cats.map((c) => (
            <Link
              key={c.slug}
              href={`/c/${c.slug}`}
              className="flex flex-col items-center gap-2 rounded-card border border-app-line bg-app-surface p-4 text-center shadow-app-shadow-1 transition-all hover:-translate-y-0.5 hover:shadow-app-shadow-2"
            >
              {/* آیکون مدیر تعریف کرده؛ اگر نبود حرف اول نام می‌آید */}
              {c.imageUrl ? (
                <Image src={c.imageUrl} alt="" width={44} height={44} className="size-11 rounded-full object-cover" />
              ) : (
                <span className="flex size-11 items-center justify-center rounded-full bg-app-primary-tint text-lg">
                  {c.name.slice(0, 1)}
                </span>
              )}
              <span className="text-[13px] font-bold text-app-ink">{c.name}</span>
            </Link>
          ))}
        </div>
      )}
    </SectionShell>
  );
}

/* ─────────────────────── شلف محصولات ─────────────────────── */
export function ProductCarouselBlock({ block, data }: CmsBlockProps) {
  const p = block.props;
  const products = pickProducts(data, pStr(p, "source", "newest"), pNum(p, "limit", 8));

  return (
    <SectionShell className="mt-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <SectionTitle title={pStr(p, "title", "محصولات")} subtitle={pStr(p, "subtitle")} />
        </div>
        {pStr(p, "ctaLabel") && pStr(p, "ctaHref") && (
          <Link href={pStr(p, "ctaHref")} className="mb-5 text-[13px] font-bold text-app-primary-strong hover:underline">
            {pStr(p, "ctaLabel")}
          </Link>
        )}
      </div>

      {products.length === 0 ? (
        <EmptyHint text="محصولی برای نمایش در این بخش نیست." />
      ) : (
        <div className="-mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-2 sm:mx-0 sm:px-0">
          {products.map((prod) => (
            <div key={prod.id} className="w-[calc(50%-6px)] shrink-0 snap-start sm:w-60">
              <ProductTile product={prod} />
            </div>
          ))}
        </div>
      )}
    </SectionShell>
  );
}

/* ─────────────────────── شبکه محصولات ─────────────────────── */
export function ProductGridBlock({ block, data }: CmsBlockProps) {
  const p = block.props;
  const products = pickProducts(data, pStr(p, "source", "newest"), pNum(p, "limit", 8));
  const cols = { "2": "grid-cols-2", "3": "grid-cols-2 sm:grid-cols-3", "4": "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" } as const;
  const col = cols[(pStr(p, "columns", "4") as keyof typeof cols) ?? "4"] ?? cols["4"];

  return (
    <SectionShell className="mt-10">
      <SectionTitle title={pStr(p, "title", "محصولات")} subtitle={pStr(p, "subtitle")} />
      {products.length === 0 ? (
        <EmptyHint text="محصولی برای نمایش در این بخش نیست." />
      ) : (
        <div className={clsx("grid gap-3", col)}>
          {products.map((prod) => (
            <ProductTile key={prod.id} product={prod} />
          ))}
        </div>
      )}
    </SectionShell>
  );
}

/* ─────────────────────── نوار برندها ─────────────────────── */
export function BrandGridBlock({ block, data }: CmsBlockProps) {
  const p = block.props;
  const limit = pNum(p, "limit", 12);
  const brands = data.brands.slice(0, limit);

  return (
    <SectionShell className="mt-10">
      <SectionTitle title={pStr(p, "title", "برندها")} center />
      {brands.length === 0 ? (
        <EmptyHint text="هنوز برندی تعریف نشده است." />
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {brands.map((b) => (
            <Link
              key={b.slug}
              href={`/search?brand=${encodeURIComponent(b.slug)}`}
              className="relative flex h-20 items-center justify-center overflow-hidden rounded-card border border-app-line bg-app-surface p-3 shadow-app-shadow-1 transition-all hover:-translate-y-0.5 hover:shadow-app-shadow-2"
            >
              {/* لوگوی برند؛ اگر نبود نام برند نمایش داده می‌شود */}
              {b.logoUrl ? (
                <Image src={b.logoUrl} alt={b.name} fill sizes="160px" className="object-contain" />
              ) : (
                <span className="text-[13px] font-bold text-app-ink">{b.name}</span>
              )}
            </Link>
          ))}
        </div>
      )}
    </SectionShell>
  );
}

/* ─────────────────────── سه ویژگی ─────────────────────── */
export function FeatureTripleBlock({ block }: CmsBlockProps) {
  const p = block.props;
  const items = pItems(p, "items").slice(0, 3);

  return (
    <SectionShell className="mt-10">
      <SectionTitle title={pStr(p, "title")} center />
      {items.length === 0 ? (
        <EmptyHint text="هنوز موردی اضافه نشده — از پنل راست اضافه کنید." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          {items.map((it, i) => (
            <div key={i} className="rounded-card border border-app-line bg-app-surface p-5 text-center shadow-app-shadow-1">
              <span className="text-2xl" aria-hidden>{it.icon || "✦"}</span>
              <h3 className="mt-2 text-[14px] font-black text-app-ink">{it.title}</h3>
              {it.text && <p className="mt-1 text-[13px] leading-7 text-app-muted">{it.text}</p>}
            </div>
          ))}
        </div>
      )}
    </SectionShell>
  );
}

/* ─────────────────────── عکس + متن ─────────────────────── */
export function ImageTextBlock({ block }: CmsBlockProps) {
  const p = block.props;
  const image = pStr(p, "imageUrl");
  const side = pStr(p, "imageSide", "start");

  return (
    <SectionShell className="mt-10">
      <div className="grid items-center gap-6 rounded-blob border border-app-line bg-app-surface p-6 shadow-app-shadow-1 sm:p-8 lg:grid-cols-2">
        {image && (
          <div
            className={clsx(
              "relative h-56 w-full overflow-hidden rounded-card lg:h-72",
              side === "end" && "lg:order-2",
            )}
          >
            <Image
              src={image}
              alt={pStr(p, "title")}
              fill
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="object-cover"
            />
          </div>
        )}
        <div className={clsx(side === "end" && !image && "lg:order-2")}>
          {pStr(p, "title") && <h2 className="text-xl font-black text-app-ink">{pStr(p, "title")}</h2>}
          {pStr(p, "text") && (
            <p className="mt-2 whitespace-pre-line text-[13px] leading-8 text-app-muted">{pStr(p, "text")}</p>
          )}
          {pStr(p, "ctaLabel") && (
            <CtaButton href={pStr(p, "ctaHref")} className="mt-4">{pStr(p, "ctaLabel")}</CtaButton>
          )}
        </div>
      </div>
    </SectionShell>
  );
}

/* ─────────────────────── متن ساده ─────────────────────── */
export function RichTextBlock({ block }: CmsBlockProps) {
  const p = block.props;
  const center = pStr(p, "align", "start") === "center";

  return (
    <SectionShell className="mt-8">
      <div className={clsx("rounded-card border border-app-line bg-app-surface p-6 shadow-app-shadow-1", center && "text-center sm:p-8")}>
        {pStr(p, "title") && <h2 className="text-lg font-black text-app-ink sm:text-xl">{pStr(p, "title")}</h2>}
        {pStr(p, "text") && (
          <p className="mt-2 whitespace-pre-line text-[13px] leading-8 text-app-muted">{pStr(p, "text")}</p>
        )}
      </div>
    </SectionShell>
  );
}

/* ─────────────────────── آمار ─────────────────────── */
export function StatsBlock({ block }: CmsBlockProps) {
  const p = block.props;
  const items = pItems(p, "items").slice(0, 4);

  return (
    <SectionShell className="mt-10">
      <SectionTitle title={pStr(p, "title")} center />
      {items.length === 0 ? (
        <EmptyHint text="عددی ثبت نشده است." />
      ) : (
        <div className={clsx("grid gap-3", items.length >= 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}>
          {items.map((it, i) => (
            <div key={i} className="rounded-card border border-app-line bg-app-surface p-5 text-center shadow-app-shadow-1">
              <p className="text-2xl font-black text-app-primary-strong tabular-nums">{it.value}</p>
              <p className="mt-1 text-[12px] text-app-muted">{it.label}</p>
            </div>
          ))}
        </div>
      )}
    </SectionShell>
  );
}

/* ─────────────────────── سوالات متداول ─────────────────────── */
export function FaqBlock({ block }: CmsBlockProps) {
  const p = block.props;
  const items = pItems(p, "items");

  return (
    <SectionShell className="mt-10">
      <SectionTitle title={pStr(p, "title", "سوالات متداول")} />
      {items.length === 0 ? (
        <EmptyHint text="پرسشی ثبت نشده است." />
      ) : (
        <div className="space-y-2">
          {items.map((it, i) => (
            <details key={i} className="group rounded-card border border-app-line bg-app-surface shadow-app-shadow-1">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-[14px] font-bold text-app-ink">
                <span>{it.q}</span>
                <span className="text-app-primary-strong transition-transform group-open:rotate-45" aria-hidden>+</span>
              </summary>
              {it.a && <p className="border-t border-app-line px-5 py-4 text-[13px] leading-8 text-app-muted">{it.a}</p>}
            </details>
          ))}
        </div>
      )}
    </SectionShell>
  );
}

/* ─────────────────────── نظرات ─────────────────────── */
export function TestimonialsBlock({ block }: CmsBlockProps) {
  const p = block.props;
  const items = pItems(p, "items");

  return (
    <SectionShell className="mt-10">
      <SectionTitle title={pStr(p, "title", "نظر مشتریان")} center />
      {items.length === 0 ? (
        <EmptyHint text="نظری ثبت نشده است." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it, i) => (
            <figure key={i} className="rounded-card border border-app-line bg-app-surface p-5 shadow-app-shadow-1">
              <blockquote className="text-[13px] leading-8 text-app-ink">«{it.text}»</blockquote>
              <figcaption className="mt-3 text-[12px] font-bold text-app-primary-strong">
                — {it.name || "مشتری"}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </SectionShell>
  );
}

/* ─────────────────────── نوار اعتماد ─────────────────────── */
export function TrustBarBlock({ block }: CmsBlockProps) {
  const p = block.props;
  const items = pItems(p, "items");

  if (items.length === 0) return null;

  return (
    <SectionShell className="mt-10">
      <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 rounded-blob border border-app-line bg-app-surface px-5 py-4 shadow-app-shadow-1">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1.5 text-[12px] font-bold text-app-ink">
            <span className="text-app-success" aria-hidden>✓</span>
            {it.text}
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}

/* ─────────────────────── خبرنامه ─────────────────────── */
export function NewsletterBlock({ block }: CmsBlockProps) {
  const p = block.props;

  return (
    <SectionShell className="mt-10">
      <div className="rounded-blob bg-app-primary-tint p-7 text-center shadow-app-shadow-1 sm:p-10">
        <h2 className="text-xl font-black text-app-ink sm:text-2xl">{pStr(p, "title", "خبرنامه")}</h2>
        {pStr(p, "subtitle") && <p className="mx-auto mt-2 max-w-md text-[13px] text-app-muted">{pStr(p, "subtitle")}</p>}
        <form className="mx-auto mt-5 flex max-w-md flex-col gap-2 sm:flex-row" onSubmit={(e) => e.preventDefault()}>
          <label className="sr-only" htmlFor={`nl-${block.id}`}>شماره موبایل</label>
          <input
            id={`nl-${block.id}`}
            type="tel"
            inputMode="tel"
            placeholder="شماره موبایل"
            className="h-11 flex-1 rounded-full border border-app-line bg-app-surface px-4 text-[13px] text-app-ink outline-none focus:border-app-primary"
          />
          <button type="submit" className="h-11 rounded-full bg-app-primary px-6 text-[13px] font-bold text-app-on-accent hover:bg-app-primary-strong">
            عضویت
          </button>
        </form>
        <p className="mt-2 text-[11px] text-app-muted">
          ثبت فرم به سرویس پیامک متصل می‌شود؛ تا آن زمان داده‌ای ذخیره نمی‌شود.
        </p>
      </div>
    </SectionShell>
  );
}

/* ─────────────────────── فاصله ─────────────────────── */
export function SpacerBlock({ block }: CmsBlockProps) {
  const sizes = { sm: "h-6", md: "h-12", lg: "h-20" } as const;
  const s = sizes[(block.props.size as keyof typeof sizes) ?? "md"] ?? sizes.md;
  return <div className={s} aria-hidden />;
}