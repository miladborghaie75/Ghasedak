"use client";

/**
 * QuickAddHost — مودال دسکتاپ / باتم‌شیت موبایل (بند ۱۳).
 * یک نمونه سراسری در layout؛ کارت فقط productId می‌فرستد.
 * انتخاب‌ها با سازگاری ترکیبی (VariantMatrix) و بدون ریدایرکت.
 */
import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useCart } from "@/components/providers/CartProvider";
import { Sheet } from "@/components/ui/Sheet";
import { VariantMatrix } from "./VariantMatrix";
import { buildAxes } from "@/lib/variant-axes";
import { getAllProductsV2 } from "@/lib/catalog-repo";
import type { ProductV2 } from "@/lib/catalog";

export function QuickAddHost() {
  const { quickAddKey, closeQuickAdd, addLine } = useCart();
  const pathname = usePathname();
  const product = getAllProductsV2().find((p) => p.id === quickAddKey);

  // بستن خودکار هنگام تغییر مسیر — شیت نباید از صفحه‌ای به صفحه دیگر حمل شود
  useEffect(() => {
    closeQuickAdd();
  }, [pathname, closeQuickAdd]);

  if (!product) return null;

  return (
    <Sheet open onClose={closeQuickAdd} title="انتخاب سایز و رنگ">
      <QuickAddBody
        product={product}
        onAdd={(variantId) => {
          addLine(variantId);
        }}
        onNavigate={closeQuickAdd}
      />
    </Sheet>
  );
}

function QuickAddBody({
  product,
  onAdd,
  onNavigate,
}: {
  product: ProductV2;
  onAdd: (variantId: string) => void;
  onNavigate: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="clamp-2 text-sm font-bold text-ink">{product.name}</h3>
        <Link
          href={`/p/${product.slug}`}
          onClick={onNavigate}
          className="shrink-0 text-xs font-semibold text-primary-strong hover:underline"
        >
          مشاهده جزئیات
        </Link>
      </div>
      <VariantMatrix product={product} axes={buildAxes(product)} />
    </div>
  );
}
