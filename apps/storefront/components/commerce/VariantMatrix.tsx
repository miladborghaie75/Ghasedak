"use client";

/**
 * VariantMatrix — انتخاب رنگ/سایز/گزینه‌ها با سازگاری ترکیبی (بند ۴۱).
 * هر انتخاب، گزینه‌های ابعاد دیگر را محدود می‌کند؛ ترکیب ناموجود قابل انتخاب نیست.
 * در PDP و QuickAdd مشترک است — نسخه تکراری وجود ندارد.
 */
import { useMemo, useState } from "react";
import { useCart } from "@/components/providers/CartProvider";
import { StockStatus } from "@/components/ui/StockStatus";
import { Price } from "@/components/ui/Price";
import { cn } from "@/lib/cn";
import { getTerm, type AttributeKey } from "@/lib/attributes";
import {
  availableOptionIds,
  resolveVariant,
} from "@/lib/catalog-repo";
import type { ProductV2 } from "@/lib/catalog";

import type { VariantAxis } from "@/lib/variant-axes";

export const AXIS_LABEL: Record<string, string> = {
  color: "رنگ",
  size: "سایز",
  underwire: "فنر",
  padding: "اسفنج",
  cup: "کاپ",
  material: "جنس",
};

interface Props {
  product: ProductV2;
  /** ابعادی که این محصول دارد (به ترتیب نمایش) — از lib/variant-axes */
  axes: VariantAxis[];
  showHeader?: boolean;
}

type Selection = Partial<Record<AttributeKey, string>>;

export function VariantMatrix({ product, axes, showHeader = false }: Props) {
  const { addLine, ready } = useCart();
  const [sel, setSel] = useState<Selection>({});
  const [added, setAdded] = useState(false);

  const variant = useMemo(() => resolveVariant(product, sel), [product, sel]);

  const pick = (axis: AttributeKey, termId: string) => {
    setSel((prev) => {
      // اگر همان ترم است، لغو انتخاب
      const next: Selection = { ...prev };
      if (prev[axis] === termId) delete next[axis];
      else next[axis] = termId;
      return next;
    });
  };

  const handleAdd = () => {
    if (!variant || !ready) return;
    addLine(variant.id);
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  };

  return (
    <div className="flex flex-col gap-4">
      {showHeader && (
        <p className="text-[13px] font-extrabold text-ink">انتخاب مشخصات</p>
      )}
      {axes.map(({ key, terms }) => {
        const available = availableOptionIds(product, key, sel);
        const selectedId = sel[key];
        const isColor = key === "color";

        return (
          <fieldset key={key}>
            <legend className="mb-2 text-[13px] font-bold text-ink">
              {AXIS_LABEL[key] ?? key}
              {selectedId && (
                <span className="ms-2 font-medium text-muted">
                  {getTerm(selectedId).label}
                </span>
              )}
            </legend>
            <div className={cn("flex flex-wrap gap-2", isColor && "gap-2.5")}>
              {terms.map((t) => {
                const isAvail = available.has(t.id);
                const isSel = selectedId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={!isAvail}
                    aria-pressed={isSel}
                    aria-label={`${AXIS_LABEL[key] ?? key} ${t.label}${isAvail ? "" : " — ناموجود"}`}
                    onClick={() => pick(key, t.id)}
                    className={
                      isColor
                        ? cn(
                            "size-10 rounded-full border-2 transition-transform",
                            isSel ? "border-primary-strong scale-110" : "border-line hover:scale-105",
                            !isAvail && "opacity-35",
                          )
                        : cn(
                            "flex h-11 min-w-12 items-center justify-center rounded-xl border px-3 text-[13px] font-semibold transition-colors",
                            isSel
                              ? "border-primary-strong bg-primary-light text-primary-strong"
                              : isAvail
                                ? "border-line bg-surface text-ink hover:border-primary hover:bg-primary-tint"
                                : "cursor-not-allowed border-line bg-primary-tint/50 text-muted line-through",
                          )
                    }
                    style={isColor ? { backgroundColor: t.hex } : undefined}
                  >
                    {!isColor && t.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      {/* قیمت/موجودی/CTA — فقط با ترکیب کامل (بند ۴۱) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <div className="flex flex-col gap-1">
          {variant ? (
            <>
              <Price price={variant.price} compareAtPrice={variant.salePrice} />
              <StockStatus stock={variant.stock} />
            </>
          ) : (
            <p className="text-[13px] text-muted">
              ترکیب رنگ و سایز را انتخاب کنید.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={!variant || !ready}
          className={cn(
            "inline-flex h-12 min-w-44 items-center justify-center rounded-full text-sm font-bold transition-all active:scale-[0.98]",
            variant
              ? added
                ? "bg-success text-white"
                : "bg-primary text-white shadow-clay-1 hover:bg-primary-hover"
              : "cursor-not-allowed bg-primary-tint text-muted",
          )}
          aria-live="polite"
        >
          {added ? "به سبدت اضافه شد 💜" : "افزودن به سبد"}
        </button>
      </div>
    </div>
  );
}
