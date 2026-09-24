import Link from "next/link";
import { HeroDrawer } from "@/components/home/HeroDrawer";
import { SectionReveal, SectionBlock, getHomeSections } from "@/components/home/HomeSectionsRenderer";
import {
  NeedNav,
  ProductShelf,
  PromoBanners,
  SectionHeader,
  TrustBar,
  GuideTeasers,
} from "@/components/home/Sections";
import { ProductCard } from "@/components/commerce/ProductCard";
import { CATEGORIES } from "@/lib/categories";
import { NEWEST_IDS, getAllProductsV2 } from "@/lib/catalog-repo";

export default async function HomePage() {
  const newest = NEWEST_IDS.map(
    (id) => getAllProductsV2().find((p) => p.id === id)!,
  );
  // دسته‌ها با شمارش واقعی محصولات (بدون دسته خالی نمایشی)
  const categories = CATEGORIES;

  // سکشن‌های منتشرشده از ادمین (صفحه‌ساز) — هرگز بر چیدمان پیش‌فرض غلبه قیمتی نمی‌کنند
  const dbSections = await getHomeSections();
  const bannerSections = dbSections.filter((s) => s.type === "BANNER");
  const tailSections = dbSections.filter((s) => ["RICH_TEXT", "IMAGE_TEXT", "NEWSLETTER"].includes(s.type));

  return (
    <>
      <HeroDrawer />
      <NeedNav />

      {/* دسته‌ها — موشن ورود ملایم با اسکرول */}
      <SectionReveal className="mx-auto mt-12 max-w-7xl px-3 sm:px-4">
        <section aria-label="دسته‌بندی‌ها">
          <SectionHeader title="دسته‌بندی‌ها" />
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {categories.map((c) => (
              <Link
                key={c.id}
                href={`/c/${c.slug}`}
                className="flex flex-col items-center gap-2 rounded-card border border-line bg-surface p-4 text-center shadow-clay-1 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-clay-2"
              >
                <span className="flex size-11 items-center justify-center rounded-full bg-primary-tint text-primary-strong">
                  <CatIcon id={c.id} />
                </span>
                <span className="text-[13px] font-bold text-ink">{c.name}</span>
              </Link>
            ))}
          </div>
        </section>
      </SectionReveal>

      {bannerSections[0] ? <SectionBlock section={bannerSections[0]} /> : <PromoBanners />}

      <SectionReveal>
        <ProductShelf title="جدیدترین‌ها">
          {newest.map((p) => (
            <div key={p.id} className="w-[calc(50%-6px)] shrink-0 snap-start sm:w-64">
              <ProductCard product={p} />
            </div>
          ))}
        </ProductShelf>
      </SectionReveal>

      {/* چیز لازم داری؟ — ویزارد کشف (بند ۹) */}
      <SectionReveal className="mx-auto mt-12 max-w-7xl px-3 sm:px-4">
        <section aria-labelledby="need-title">
          <div className="rounded-blob border border-line bg-gradient-to-l from-primary-tint to-bg p-6 shadow-clay-1 sm:p-10">
            <h2 id="need-title" className="text-center font-display text-2xl text-plum sm:text-3xl">
              چی لازم داری؟
            </h2>
            <p className="mx-auto mt-2 max-w-md text-center text-[13px] leading-7 text-muted">
              نمی‌دونی دقیقاً چی می‌خوای؟ سه سؤال کوتاه جوابت رو می‌دیم.
            </p>
            <div className="mt-5 text-center">
              <Link
                href="/need"
                className="inline-flex h-12 items-center rounded-full bg-primary px-7 text-sm font-bold text-white shadow-clay-1 transition-all hover:bg-primary-press hover:shadow-clay-2 active:scale-[0.98]"
              >
                شروع راهنما
              </Link>
            </div>
          </div>
        </section>
      </SectionReveal>

      <SectionReveal>
        <TrustBar />
      </SectionReveal>
      <SectionReveal>
        <GuideTeasers />
      </SectionReveal>

      {/* سکشن‌های سفارشی انتهای صفحه از صفحه‌ساز */}
      {tailSections.map((s) => (
        <SectionBlock key={s.id} section={s} />
      ))}
    </>
  );
}

/** آیکون کوچک دسته برای گرید */
function CatIcon({ id }: { id: string }) {
  const s = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const paths: Record<string, React.ReactNode> = {
    bra: <path d="M3 13c2-1 3.5-4 4-7 .2-1 1.8-1 2 0 .4 3.4 1.6 6 3 7.5m0 0c1.4-1.5 2.6-4.1 3-7.5.2-1 1.8-1 2 0 .5 3 2 6 4 7m-18 0c2 2.5 5.5 4 9 4s7-1.5 9-4" {...s} />,
    panty: <path d="M5 6h14c0 4-1 8-4 11-1.5 1.6-3 2-4.5 2S7.5 18.6 6 17C4 14 5 10 5 6z" {...s} />,
    set: <path d="M6 9c-.5-3 .5-5.5 2-6.5C8.7 2 9.4 2 10 2s1.3 0 2 .5c1.5 1 2.5 3.5 2 6.5m-4 4.5h4c0 3-.6 5-2 6.5-1.4-1.5-2-3.5-2-6.5z" {...s} />,
    shapewear: <path d="M7 3h10v18H7zm3.5 0v18M13.5 3v18" {...s} />,
    sport: <path d="M6 8h12v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zm2 0c0-3 1.7-5 4-5s4 2 4 5" {...s} />,
    sleepwear: <path d="M8 3h8v18H8zm0 0c1-1.4 2.4-2 4-2s3 .6 4 2" {...s} />,
  };
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      {paths[id]}
    </svg>
  );
}
