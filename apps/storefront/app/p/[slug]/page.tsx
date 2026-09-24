import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ProductArt, type ArtKind } from "@/components/commerce/ProductArt";
import { WishlistButton } from "@/components/commerce/WishlistButton";
import { StickyBuyBar } from "@/components/commerce/StickyBuyBar";
import { RelatedShelf } from "@/components/commerce/RelatedShelf";
import { SizeGuideButton } from "@/components/commerce/SizeGuide";
import { VariantMatrix } from "@/components/commerce/VariantMatrix";
import { buildAxes } from "@/lib/variant-axes";
import { Price } from "@/components/ui/Price";
import { faNum } from "@/lib/format";
import { getTerm } from "@/lib/attributes";
import {
  getAllProductsV2,
  getBrandV2,
  getProductV2BySlug,
  hasAnyStock,
  isNewProduct,
  minPrice,
  salePriceOf,
} from "@/lib/catalog-repo";
import { CATEGORIES } from "@/lib/categories";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return getAllProductsV2().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const p = getProductV2BySlug(slug);
  if (!p) return {};
  const brand = getBrandV2(p.brandId);
  return {
    title: `${p.name}${brand ? ` — ${brand.name}` : ""}`,
    description: `${p.name}. ${p.short} — با راهنمای سایز و ارسال سریع.`,
  };
}

export default async function ProductPage({ params }: PageProps) {
  const { slug } = await params;
  const product = getProductV2BySlug(slug);
  if (!product) notFound();

  const brand = getBrandV2(product.brandId);
  const cat = CATEGORIES.find((c) => c.id === product.category);
  const base = minPrice(product);
  const sale = salePriceOf(product);
  const colors = [...new Set(product.variants.map((v) => v.colorId))];
  const materials = product.attributeIds;
  const inStock = hasAnyStock(product);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.short,
    category: cat?.name,
    material: materials.map((m) => safeLabel(m)).join("، "),
    brand: brand ? { "@type": "Brand", name: brand.name } : undefined,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "IRR",
      lowPrice: sale ?? base,
      highPrice: Math.max(...product.variants.map((v) => v.salePrice ?? v.price)),
      offerCount: product.variants.length,
      availability: inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
    },
  };

  return (
    <div className="mx-auto max-w-7xl px-3 pb-28 sm:px-4 lg:pb-0">
      <nav aria-label="مسیر صفحه" className="py-3 text-[12px] text-muted">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li><Link href="/" className="hover:text-primary-strong">خانه</Link></li>
          <li aria-hidden>/</li>
          <li><Link href={`/c/${cat?.slug}`} className="hover:text-primary-strong">{cat?.name}</Link></li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="font-bold text-ink">{product.name}</li>
        </ol>
      </nav>

      <div className="grid gap-6 lg:grid-cols-2 lg:gap-10">
        {/* ۱) گالری */}
        <section aria-label="تصویر محصول" className="self-start lg:sticky lg:top-24">
          <div className="relative rounded-blob border border-line bg-gradient-to-b from-primary-tint to-surface p-6 shadow-clay-1 sm:p-10">
            <div className="absolute start-4 top-4 z-10">
              <WishlistButton productId={product.id} name={product.name} />
            </div>
            <ProductArt kind={product.category as ArtKind} colorId={product.variants[0].colorId} />
          </div>
        </section>

        {/* اطلاعات */}
        <section aria-label="اطلاعات محصول">
          <div className="flex flex-wrap items-center gap-2">
            {brand && (
              <Link href={`/search?q=${encodeURIComponent(brand.name)}`} className="rounded-full bg-primary-soft px-3 py-1 text-[11px] font-bold text-primary-strong">
                {brand.name}
              </Link>
            )}
            {isNewProduct(product) && (
              <span className="rounded-full bg-primary-light px-2.5 py-1 text-[11px] font-bold text-primary-strong">جدید</span>
            )}
            {materials.map((m) => (
              <span key={m} className="rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-muted">
                {safeLabel(m)}
              </span>
            ))}
          </div>

          {/* ۲) نام */}
          <h1 className="mt-3 text-2xl font-extrabold leading-9 text-ink sm:text-[28px]">
            {product.name}
          </h1>

          {/* توضیح کوتاه */}
          <p className="mt-2 text-[13px] leading-7 text-muted">{product.short}</p>

          {/* ۴) قیمت */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Price price={sale ?? base} compareAtPrice={sale != null ? base : undefined} size="lg" />
            {sale == null && <span className="text-[12px] text-muted">از قیمت</span>}
          </div>

          {/* ۵-۸) رنگ/سایز/سایزگاید/موجودی + ۱۰) افزودن */}
          <div className="mt-5 rounded-card border border-line bg-surface p-4 shadow-clay-1">
            <VariantMatrix product={product} axes={buildAxes(product)} />
            <p className="mt-3 text-[12px] leading-6 text-muted">
              <strong className="font-extrabold text-ink">راهنمای سایز:</strong> برای انتخاب دقیق، دور سینه و زیر سینه را با متر اندازه بگیرید —{" "}
              <SizeGuideButton />
            </p>
          </div>

          {/* ۱۱) مشخصات */}
          <dl className="mt-5 grid grid-cols-2 gap-3 rounded-card border border-line bg-surface p-4 shadow-clay-1 sm:grid-cols-4">
            <Spec label="جنس" value={materials.map((m) => safeLabel(m)).join("، ")} />
            <Spec label="دسته" value={cat?.name ?? "—"} />
            <Spec label="رنگ‌ها" value={faNum(colors.length)} />
            <Spec label="موجودی کل" value={`${faNum(product.variants.reduce((s, v) => s + v.stock, 0))} عدد`} />
          </dl>

          {/* ۱۶) ارسال/بازگشت */}
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-card border border-line bg-primary-tint/60 p-4">
              <p className="text-[13px] font-extrabold text-ink">ارسال</p>
              <p className="mt-1 text-[12px] leading-6 text-muted">
                پست پیشتاز ۳ تا ۵ روز کاری؛ ارسال رایگان برای خرید بالای ۱٬۵۰۰٬۰۰۰ تومان.
              </p>
            </div>
            <div className="rounded-card border border-line bg-primary-tint/60 p-4">
              <p className="text-[13px] font-extrabold text-ink">بازگشت کالا</p>
              <p className="mt-1 text-[12px] leading-6 text-muted">
                به دلایل بهداشتی، لباس زیر فقط با پلمب بازنشده قابل بازگشت است.
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* ۱۹) مرتبط‌ها */}
      <RelatedShelf product={product} />

      {/* Sticky موبایل */}
      <StickyBuyBar product={product} />

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="mt-0.5 text-[13px] font-bold text-ink">{value}</dd>
    </div>
  );
}

function safeLabel(id: string): string {
  try {
    return getTerm(id).label;
  } catch {
    return id;
  }
}
