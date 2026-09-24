import Link from "next/link";
import { Chip } from "@/components/ui/Chip";
import { faNum } from "@/lib/format";
import { NEEDS } from "@/lib/needs";
import type { ArtKind } from "@/components/commerce/ProductArt";

/** ریل چیپ‌های نیازمحور — برای کاربری که «نمی‌داند دقیقاً چه می‌خواهد» */
export function NeedNav() {
  return (
    <nav aria-label="خرید بر اساس نیاز" className="mt-3 flex flex-wrap items-center justify-center gap-2 px-3 sm:px-4">
      {NEEDS.map((n) => (
        <Link key={n.slug} href={`/need?start=${n.slug}`} className="inline-flex">
          <Chip>{n.label}</Chip>
        </Link>
      ))}
    </nav>
  );
}

/** سرصفحه سکشن با لینک «مشاهده همه» — الگوی تکرارشونده */
export function SectionHeader({
  title,
  href,
  linkLabel = "مشاهده همه",
}: {
  title: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="font-display text-2xl text-plum">{title}</h2>
      {href && (
        <Link
          href={href}
          className="inline-flex h-10 items-center rounded-full bg-surface px-4 text-[13px] font-bold text-primary-strong border border-line shadow-clay-1 hover:bg-primary-tint"
        >
          {linkLabel}
        </Link>
      )}
    </div>
  );
}

/** شلف افقی محصولات — ریل اسکرولی با کارت‌های هم‌عرض */
export function ProductShelf({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mx-auto mt-12 max-w-7xl px-3 sm:px-4" aria-label={title}>
      <SectionHeader title={title} />
      <div className="flex gap-3 sm:gap-4 overflow-x-auto pb-2 [scrollbar-width:thin] snap-x">
        {children}
      </div>
    </section>
  );
}

/** بنرهای تبلیغاتی نیازمحور — فقط به دسته‌های واقعی لینک می‌دهند */
export function PromoBanners() {
  const banners: {
    title: string;
    sub: string;
    href: string;
    bg: string;
    icon: ArtKind;
  }[] = [
    {
      title: "راحتی در حرکت",
      sub: "مجموعه لباس زیر ورزشی",
      href: "/c/sport",
      bg: "from-primary-soft to-primary-tint",
      icon: "sport",
    },
    {
      title: "زیبایی در جزئیات",
      sub: "ست‌های هماهنگ سوتین و شورت",
      href: "/c/set",
      bg: "from-primary-tint to-bg",
      icon: "set",
    },
  ];
  return (
    <section aria-label="پیشنهادهای ویژه" className="mx-auto mt-12 max-w-7xl px-3 sm:px-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {banners.map((b) => (
          <Link
            key={b.title}
            href={b.href}
            className={`group flex items-center justify-between gap-3 overflow-hidden rounded-blob bg-gradient-to-l ${b.bg} border border-line p-5 shadow-clay-1 transition-shadow hover:shadow-clay-2 sm:p-6`}
          >
            <div>
              <p className="font-display text-xl text-plum sm:text-2xl">{b.title}</p>
              <p className="mt-1 text-xs text-muted sm:text-[13px]">{b.sub}</p>
            </div>
            <span
              aria-hidden
              className="flex size-16 shrink-0 items-center justify-center rounded-full bg-surface/70 shadow-clay-1 transition-transform group-hover:scale-105"
            >
              <CategoryGlyph kind={b.icon} className="size-9" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** چهار مزیت اعتمادساز — فقط ادعاهای قابل ارائه (بند ۲۸) */
export function TrustBar() {
  const items = [
    { title: "ارسال سریع", sub: "بسته‌بندی محرمانه", icon: "truck" as const },
    { title: "پرداخت امن", sub: "درگاه معتبر بانکی", icon: "shield" as const },
    { title: "راهنمای سایز", sub: "قبل از خرید اندازه بگیرید", icon: "ruler" as const },
    { title: "پشتیبانی واقعی", sub: "پاسخ انسانی، نه ربات", icon: "chat" as const },
  ];
  return (
    <section aria-label="مزایای خرید" className="mx-auto mt-12 max-w-7xl px-3 sm:px-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {items.map((i) => (
          <div
            key={i.title}
            className="flex flex-col items-center gap-2 rounded-card border border-line bg-surface p-4 text-center shadow-clay-1"
          >
            <span className="flex size-11 items-center justify-center rounded-full bg-primary-tint text-primary-strong">
              <TrustIcon kind={i.icon} />
            </span>
            <p className="text-[13px] font-extrabold text-ink">{i.title}</p>
            <p className="text-[11px] leading-5 text-muted">{i.sub}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/** تیزر راهنماها */
export function GuideTeasers() {
  return (
    <section aria-label="راهنمای خرید" className="mx-auto mt-12 max-w-7xl px-3 sm:px-4">
      <SectionHeader title="راهنمای انتخاب" href="/guides/size" linkLabel="همه راهنماها" />
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { title: "چطور سایز سوتینم را دقیق بفهمم؟", slug: "size", min: 3 },
          { title: "نخ بهتر است یا مودال؟", slug: "fabric", min: 2 },
          { title: "شست‌وشوی لباس زیر بدون آسیب", slug: "care", min: 2 },
        ].map((g) => (
          <Link
            key={g.slug}
            href={`/guides/${g.slug}`}
            className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-4 shadow-clay-1 transition-shadow hover:shadow-clay-2"
          >
            <div>
              <p className="text-[13px] font-bold text-ink">{g.title}</p>
              <p className="mt-1 text-[11px] text-muted tnum">{faNum(g.min)} دقیقه مطالعه</p>
            </div>
            <span aria-hidden className="text-primary-strong">←</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ── گلیف‌های خطی مشترک ───────────────────────────── */
function CategoryGlyph({ kind, className }: { kind: ArtKind; className?: string }) {
  const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (kind) {
    case "sport":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden>
          <path d="M6 8h12v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" {...s} />
          <path d="M8 8c0-3 1.7-5 4-5s4 2 4 5" {...s} />
        </svg>
      );
    case "set":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden>
          <path d="M6 9c-.5-3 .5-5.5 2-6.5C8.7 2 9.4 2 10 2s1.3 0 2 .5c1.5 1 2.5 3.5 2 6.5" {...s} />
          <path d="M10 14h4c0 3-.6 5-2 6.5-1.4-1.5-2-3.5-2-6.5z" {...s} />
        </svg>
      );
    case "bra":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden>
          <path d="M3 13c2-1 3.5-4 4-7 .2-1 1.8-1 2 0 .4 3.4 1.6 6 3 7.5" {...s} />
          <path d="M12 13.5c1.4-1.5 2.6-4.1 3-7.5.2-1 1.8-1 2 0 .5 3 2 6 4 7" {...s} />
          <path d="M3 13c2 2.5 5.5 4 9 4s7-1.5 9-4" {...s} />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden>
          <circle cx="12" cy="12" r="8" {...s} />
        </svg>
      );
  }
}

function TrustIcon({ kind }: { kind: "truck" | "shield" | "ruler" | "chat" }) {
  const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (kind) {
    case "truck":
      return (
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
          <rect x="2" y="7" width="12" height="10" rx="2" {...s} />
          <path d="M14 10h4l3 3v4h-7" {...s} />
          <circle cx="7" cy="17" r="1.6" {...s} />
          <circle cx="17" cy="17" r="1.6" {...s} />
        </svg>
      );
    case "shield":
      return (
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
          <path d="M12 3l7 2.5v5c0 5-3 8.5-7 10.5-4-2-7-5.5-7-10.5v-5z" {...s} />
          <path d="m9 12 2 2 4-4" {...s} />
        </svg>
      );
    case "ruler":
      return (
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
          <rect x="2.5" y="9" width="19" height="6" rx="2" {...s} />
          <path d="M7 9v3M11 9v3M15 9v3M19 9v3" {...s} />
        </svg>
      );
    case "chat":
      return (
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
          <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4z" {...s} />
          <path d="M8 9h8M8 12.5h5" {...s} />
        </svg>
      );
  }
}
