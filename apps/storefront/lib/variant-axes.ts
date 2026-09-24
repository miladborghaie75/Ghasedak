/**
 * ساخت محورهای انتخاب تنوع یک محصول بر اساس دسته — سرور-امن
 * (همان منطق برای QuickAdd و PDP؛ بند ۱۹: فیلتر/انتخاب آگاه‌به‌دسته)
 */
import {
  termsOf,
  categoryHas,
  type AttributeKey,
} from "./attributes";
import type { ProductV2 } from "./catalog";

export interface VariantAxis {
  key: AttributeKey;
  terms: { id: string; label: string; hex?: string; order: number }[];
}

export function buildAxes(product: ProductV2): VariantAxis[] {
  const axes: VariantAxis[] = [];
  const colorIds = [...new Set(product.variants.map((v) => v.colorId))];
  const sizeIds = [...new Set(product.variants.map((v) => v.sizeId))];
  const optionIds = [...new Set(product.variants.flatMap((v) => v.optionIds))];

  axes.push({ key: "color", terms: termsOf("color").filter((t) => colorIds.includes(t.id)) });
  axes.push({ key: "size", terms: termsOf("size").filter((t) => sizeIds.includes(t.id)) });

  if (categoryHas.underwire(product.category)) {
    const uw = optionIds.filter((id) => id.startsWith("uw-"));
    if (uw.length) axes.push({ key: "underwire", terms: termsOf("underwire").filter((t) => uw.includes(t.id)) });
    const pd = optionIds.filter((id) => id.startsWith("pd-"));
    if (pd.length) axes.push({ key: "padding", terms: termsOf("padding").filter((t) => pd.includes(t.id)) });
    const cp = optionIds.filter((id) => id.startsWith("cup-"));
    if (cp.length) axes.push({ key: "cup", terms: termsOf("cup").filter((t) => cp.includes(t.id)) });
  }
  return axes;
}
