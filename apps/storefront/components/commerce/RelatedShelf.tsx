import { ProductCard } from "./ProductCard";
import { SectionHeader } from "@/components/home/Sections";
import { getAllProductsV2 } from "@/lib/catalog-repo";
import type { ProductV2 } from "@/lib/catalog";

/** محصولات مرتبط: همان دسته، حذف خود محصول، حداکثر ۴ */
export function RelatedShelf({ product }: { product: ProductV2 }) {
  const related = getAllProductsV2()
    .filter((p) => p.category === product.category && p.id !== product.id)
    .slice(0, 4);

  if (!related.length) return null;

  return (
    <section aria-label="محصولات مرتبط" className="mt-12">
      <SectionHeader title="محصولات مرتبط" />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {related.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
