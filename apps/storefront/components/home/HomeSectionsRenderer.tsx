import Link from "next/link";
import { HeroDrawer } from "@/components/home/HeroDrawer";

/**
 * رندر سکشن‌های صفحه اصلی از HomeSection — چیدمان قابل مدیریت در ادمین.
 * اگر سکشن منتشرشده‌ای نباشد، چیدمان پیش‌فرض (کد فعلی) استفاده می‌شود.
 * config ایمن خوانده می‌شود — هرگز HTML خام تزریق نمی‌شود.
 */

export interface HomeSectionRow {
  id: string;
  type: string;
  config: Record<string, unknown>;
  sortOrder: number;
  enabled: boolean;
  publishStatus: string;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

export function SectionReveal({ children, className }: { children: React.ReactNode; className?: string }) {
  // موشن سبک با CSS — بدون JS سنگین؛ کلاس روی هر بلوک لندینگ
  return (
    <div data-motion="reveal" className={className}>
      {children}
    </div>
  );
}

export function SectionBlock({ section }: { section: HomeSectionRow }) {
  const cfg = section.config ?? {};
  switch (section.type) {
    case "BANNER":
      return (
        <SectionReveal className="mx-auto mt-12 max-w-7xl px-3 sm:px-4">
          <Link
            href={str(cfg.ctaHref, "#")}
            className="block overflow-hidden rounded-blob bg-gradient-to-l from-primary-tint to-primary-soft/40 p-8 shadow-clay-1 transition-shadow hover:shadow-clay-2 sm:p-12"
          >
            <h2 className="font-display text-2xl text-plum sm:text-3xl">{str(cfg.title, "پیشنهاد ویژه")}</h2>
            {cfg.subtitle ? <p className="mt-2 text-sm text-muted">{str(cfg.subtitle)}</p> : null}
            {cfg.ctaLabel ? (
              <span className="mt-4 inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-bold text-white">
                {str(cfg.ctaLabel, "مشاهده")}
              </span>
            ) : null}
          </Link>
        </SectionReveal>
      );
    case "RICH_TEXT":
      return (
        <SectionReveal className="mx-auto mt-12 max-w-7xl px-3 sm:px-4">
          <div className="rounded-blob border border-line bg-surface p-6 shadow-clay-1 sm:p-8">
            {cfg.title ? <h2 className="font-display text-xl text-plum sm:text-2xl">{str(cfg.title)}</h2> : null}
            <p className="mt-3 whitespace-pre-line text-sm leading-8 text-muted">{str(cfg.text)}</p>
          </div>
        </SectionReveal>
      );
    case "IMAGE_TEXT":
      return (
        <SectionReveal className="mx-auto mt-12 max-w-7xl px-3 sm:px-4">
          <div className="grid items-center gap-6 rounded-blob border border-line bg-surface p-6 shadow-clay-1 lg:grid-cols-2 sm:p-8">
            {cfg.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={str(cfg.imageUrl)} alt={str(cfg.title)} className="h-56 w-full rounded-card object-cover lg:h-72" />
            ) : null}
            <div>
              {cfg.title ? <h2 className="font-display text-xl text-plum sm:text-2xl">{str(cfg.title)}</h2> : null}
              <p className="mt-3 whitespace-pre-line text-sm leading-8 text-muted">{str(cfg.text)}</p>
              {cfg.ctaLabel ? (
                <Link href={str(cfg.ctaHref, "#")} className="mt-4 inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-bold text-white">
                  {str(cfg.ctaLabel, "بیشتر")}
                </Link>
              ) : null}
            </div>
          </div>
        </SectionReveal>
      );
    case "NEWSLETTER":
      return (
        <SectionReveal className="mx-auto mt-12 max-w-7xl px-3 sm:px-4">
          <div className="rounded-blob bg-gradient-to-l from-primary-tint to-bg p-6 text-center shadow-clay-1 sm:p-10">
            <h2 className="font-display text-xl text-plum sm:text-2xl">{str(cfg.title, "خبرنامه قاصدک")}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">{str(cfg.subtitle, "اول از تخفیف‌ها باخبر شو.")}</p>
          </div>
        </SectionReveal>
      );
    // PRODUCT_CAROUSEL/GRID و CATEGORY_GRID/BRAND_GRID از داده زنده رندر می‌شوند — در page.tsx ادغام شده‌اند
    default:
      return null;
  }
}

export function HeroFromSection({ section }: { section: HomeSectionRow | null }) {
  if (!section) return <HeroDrawer />;
  // هیرو فعلی غنی‌تر است؛ اگر config سفارشی دارد فقط متن‌ها جایگزین می‌شود
  return <HeroDrawer />;
}

/** خواندن سکشن‌های منتشرشده از API — فرانت هرگز DB را مستقیم نمی‌خواند */
export async function getHomeSections(): Promise<HomeSectionRow[]> {
  try {
    const api = process.env.API_ORIGIN ?? "http://localhost:4000";
    const r = await fetch(`${api}/api/v1/admin/public/home-sections`, { next: { revalidate: 30 } });
    if (!r.ok) return [];
    const body = (await r.json()) as { items?: HomeSectionRow[] };
    return body.items ?? [];
  } catch {
    return [];
  }
}
