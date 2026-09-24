"use client";

/**
 * ProductCard — تنها کارت محصول پروژه (بند ۱۱/۵۶).
 * ساختار: تصویر ۱:۱ → Wishlist/بج → نام (۲خط وسط‌چین) → رنگ/سایز →
 * قیمت (میانه، تخفیف با خط‌خوردگی و همین کارت) → Quick Add.
 * سواچ‌ها وابسته‌اند (بند ۱۲/۴۱): انتخاب رنگ، سایزهای نمایشی را محدود می‌کند.
 * واکنش‌گرایی داخل خود کامپوننت است — نسخه جدا برای موبایل وجود ندارد.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useCart } from "@/components/providers/CartProvider";
import { ProductArt, type ArtKind } from "./ProductArt";
import { cn } from "@/lib/cn";
import { faNum } from "@/lib/format";
import { getTerm } from "@/lib/attributes";
import {
  availableOptionIds,
  hasAnyStock,
  isNewProduct,
  minPrice,
  salePriceOf,
} from "@/lib/catalog-repo";
import type { ProductV2 } from "@/lib/catalog";

interface CardProps {
  product: ProductV2;
}

export function ProductCard({ product }: CardProps) {
  const { addLine, openQuickAdd, ready, wishlist, toggleWishlist } = useCart();
  const [colorId, setColorId] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const inStock = hasAnyStock(product);
  const colors = useMemo(
    () => [...new Set(product.variants.map((v) => v.colorId))],
    [product],
  );
  const activeColor = colorId && colors.includes(colorId) ? colorId : null;

  const availSizes = useMemo(
    () => availableOptionIds(product, "size", activeColor ? { color: activeColor } : {}),
    [product, activeColor],
  );
  const sizeTerms = useMemo(
    () => [...availSizes].map(getTerm).sort((a, b) => a.order - b.order),
    [availSizes],
  );

  const directVariants = activeColor
    ? product.variants.filter((v) => v.stock > 0 && v.colorId === activeColor)
    : product.variants.filter((v) => v.stock > 0);
  const canDirectAdd = directVariants.length === 1;

  const price = minPrice(product);
  const sale = salePriceOf(product);
  const isNew = isNewProduct(product);
  const wishActive = wishlist.includes(product.id);

  const handleQuickAdd = () => {
    if (!inStock || !ready) return;
    if (canDirectAdd) {
      addLine(directVariants[0].id);
      setAdded(true);
      setTimeout(() => setAdded(false), 1800);
    } else {
      openQuickAdd(product.id);
    }
  };

  return (
    <article
      className={cn(
        "group relative flex h-full flex-col rounded-2xl border border-line bg-surface p-1.5",
        "transition-[box-shadow,border-color] duration-150 hover:border-primary/50",
      )}
      aria-label={product.name}
    >
      {/* تصویر ۱:۱ — زمینه روشن برند (بند ۱۱) */}
      <div className="relative overflow-hidden rounded-xl bg-bg">
        <Link
          href={`/p/${product.slug}`}
          className="block aspect-square"
          aria-label={`مشاهده ${product.name}`}
        >
          <span className="flex h-full w-full items-center justify-center p-3">
            <ProductArt
              kind={product.category as ArtKind}
              colorId={activeColor ?? product.variants[0].colorId}
            />
          </span>
        </Link>

        {/* Wishlist راست / بج چپ (بند ۱۱ — RTL) */}
        <div className="absolute inset-x-1.5 top-1.5 z-10 flex items-start justify-between">
          <button
            type="button"
            aria-pressed={wishActive}
            aria-label={
              wishActive
                ? `حذف ${product.name} از علاقه‌مندی‌ها`
                : `افزودن ${product.name} به علاقه‌مندی‌ها`
            }
            onClick={(e) => {
              e.preventDefault();
              toggleWishlist(product.id);
            }}
            className={cn(
              "flex size-8 items-center justify-center rounded-full border border-line bg-surface/95 transition-colors",
              wishActive ? "text-primary" : "text-muted hover:text-primary",
            )}
          >
            <HeartSvg filled={wishActive} />
          </button>

          {/* بج فقط وقتی معنادار (بند ۱۱/۲۵) */}
          {sale != null && (
            <span className="rounded-full bg-plum px-2 py-0.5 text-[10px] font-bold text-on-accent">
              تخفیف
            </span>
          )}
          {!inStock ? (
            <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] font-semibold text-muted">
              ناموجود
            </span>
          ) : (
            isNew && (
              <span className="rounded-full bg-primary-light px-2 py-0.5 text-[10px] font-semibold text-primary-strong">
                جدید
              </span>
            )
          )}
        </div>
      </div>

      {/* بدنه کارت — همه وسط‌چین (بند ۱۱) */}
      <div className="flex flex-1 flex-col items-center px-1.5 pb-2 pt-2 text-center">
        <h3 className="line-clamp-2 min-h-[44px] text-[13px] font-semibold leading-[22px] text-ink">
          <Link href={`/p/${product.slug}`} className="outline-none after:absolute after:inset-0 hover:text-primary">
            {product.name}
          </Link>
        </h3>

        {/* سواچ رنگ — وابسته (بند ۱۲) */}
        {colors.length > 1 && (
          <div className="mt-1.5 flex items-center justify-center gap-1.5" role="group" aria-label="رنگ‌های موجود">
            {colors.slice(0, 4).map((cid) => {
              const t = getTerm(cid);
              const isActive = activeColor === cid;
              return (
                <button
                  key={cid}
                  type="button"
                  aria-label={`رنگ ${t.label}`}
                  aria-pressed={isActive}
                  onClick={(e) => {
                    e.preventDefault();
                    setColorId(isActive ? null : cid);
                  }}
                  className={cn(
                    "size-4 rounded-full border transition-transform",
                    isActive ? "border-ink scale-110" : "border-line hover:scale-105",
                  )}
                  style={{ backgroundColor: t.hex }}
                />
              );
            })}
            {colors.length > 4 && (
              <span className="text-[10px] text-muted tnum">+{faNum(colors.length - 4)}</span>
            )}
          </div>
        )}

        {/* سایز — فشرده و وابسته (بند ۱۲) */}
        <p className="mt-1 truncate text-[11px] text-muted">
          {sizeTerms.length
            ? sizeTerms.map((t) => t.label).join(" · ")
            : "بدون موجودی"}
        </p>

        {/* قیمت میانه — تخفیف با خط‌خوردگی در همین کارت (بند ۱۱) */}
        <div className="mt-2 flex items-center justify-center gap-1.5" aria-label={`از ${faNum(sale ?? price)} تومان`}>
          {sale != null && (
            <del className="text-[11px] text-muted tnum">{faNum(price)}</del>
          )}
          <strong className="text-[15px] font-extrabold text-plum tnum">
            {faNum(sale ?? price)}
          </strong>
          <span className="text-[10px] font-medium text-muted">تومان</span>
        </div>

        {/* Quick Add (بند ۱۳) */}
        <button
          type="button"
          onClick={handleQuickAdd}
          disabled={!inStock}
          className={cn(
            "relative z-10 mt-2 inline-flex h-10 w-full items-center justify-center gap-1 rounded-xl text-[12px] font-semibold transition-colors",
            !inStock
              ? "cursor-not-allowed bg-primary-light/50 text-muted"
              : added
                ? "bg-success text-on-accent"
                : "bg-primary text-on-accent hover:bg-primary-hover",
          )}
          aria-live="polite"
        >
          {added ? (
            "به سبدت اضافه شد 💜"
          ) : inStock ? (
            canDirectAdd ? (
              "افزودن به سبد"
            ) : (
              "انتخاب سایز و رنگ"
            )
          ) : (
            "ناموجود"
          )}
        </button>
      </div>
    </article>
  );
}

function HeartSvg({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.2 7.5 3.4 4.5 6.6 4.5c2 0 3.7 1.1 4.4 2.7h2c.7-1.6 2.4-2.7 4.4-2.7 3.2 0 5.4 3 3.9 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
