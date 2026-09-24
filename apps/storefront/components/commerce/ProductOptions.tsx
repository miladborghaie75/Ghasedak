"use client";

/**
 * سیم‌کشی PDP — VariantMatrix + SizeFinder در یک کلاینت‌کامپوننت (بند ۴۳).
 * توصیهٔ سایز مستقیماً روی انتخابگر اعمال می‌شود؛ nonce برای اعمال دوباره.
 * نگاشت توصیه → گزینه‌های واقعاً موجودِ محصول: اگر سایز/کاپ پیشنهادی در این
 * محصول نیست، نزدیک‌ترین گزینه موجود انتخاب می‌شود (هرگز ترکیب ناموجود set نمی‌شود).
 */
import { useMemo, useState } from "react";
import { VariantMatrix } from "./VariantMatrix";
import { SizeFinderButton } from "./SizeFinder";
import { buildAxes } from "@/lib/variant-axes";
import type { AttributeKey } from "@/lib/attributes";
import type { ProductV2 } from "@/lib/catalog";

/** نزدیک‌ترین ترم موجود بر اساس ترتیب نمایش (فاصله عددی/ترتیبی) */
function nearestTerm(
  terms: Array<{ id: string; order: number }> | undefined,
  wantedId: string | null | undefined,
): string | undefined {
  if (!terms || terms.length === 0) return undefined;
  if (!wantedId) return undefined;
  const exact = terms.find((t) => t.id === wantedId);
  if (exact) return exact.id;
  const wanted = terms.find((t) => t.id === wantedId);
  if (wanted) return wanted.id;
  // ترتیب مرجع را از شناسه‌های شناخته‌شده می‌سازیم: sz-70..95 و cup-A..D
  const orderOf = (id: string): number | null => {
    const sizeM = /^sz-(\d+)$/.exec(id);
    if (sizeM) return Number(sizeM[1]);
    const cupM = /^cup-([A-D])$/.exec(id);
    if (cupM) return cupM[1].charCodeAt(0);
    const letterM = /^sz-([SMLX]+)$/.exec(id);
    if (letterM) return { S: 1, M: 2, L: 3, XL: 4 }[letterM[1]] ?? null;
    return null;
  };
  const target = orderOf(wantedId);
  if (target == null) return undefined;
  const ranked = terms
    .map((t) => ({ id: t.id, d: Math.abs((orderOf(t.id) ?? 0) - target) }))
    .sort((a, b) => a.d - b.d);
  return ranked[0]?.id;
}

export function ProductOptions({
  product,
  brandId,
}: {
  product: ProductV2;
  brandId?: string;
}) {
  const [preselect, setPreselect] = useState<{
    size?: string;
    cup?: string | null;
    nonce: number;
  }>({ nonce: 0 });

  const axes = useMemo(() => buildAxes(product), [product]);
  const termsOf = (key: AttributeKey) => axes.find((a) => a.key === key)?.terms;

  return (
    <div className="flex flex-col gap-3">
      <VariantMatrix product={product} axes={axes} preselect={preselect} />
      <div className="flex flex-wrap items-center gap-2">
        <SizeFinderButton
          category={product.category}
          productId={product.id}
          brandId={brandId}
          onApply={(size, cup) =>
            setPreselect({
              size: nearestTerm(termsOf("size"), size),
              cup: nearestTerm(termsOf("cup"), cup) ?? null,
              nonce: Date.now(),
            })
          }
        />
        <span className="text-[11px] leading-5 text-muted">
          سه گام کوتاه با متر — توصیه است، نه حکم قطعی.
        </span>
      </div>
    </div>
  );
}
