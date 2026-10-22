import { ArtPlaque, ArtSilhouette, type ArtKind } from "@ghasedak/blocks";
import { getTerm } from "@/lib/attributes";

/**
 * آرت محصول در فروشگاه — پوستهٔ نازک روی تک‌منبعِ مشترک (`@ghasedak/blocks`).
 *
 * چرا پوسته؟ خودِ شکل‌ها و قاب در پکیج بلوک‌هاست تا بلوک «نمونه‌کار» صفحه‌ساز هم
 * دقیقاً همان تصویر و همان پاسپارتو را بکشد. اینجا فقط یک کار انجام می‌شود:
 * تبدیل شناسهٔ ترم رنگ محصول (`colorId`) به رنگ واقعی. اگر ترم ناشناخته بود،
 * رنگ برند از توکن می‌آید — نه hex خام.
 *
 * قانون برند: هیچ عکس مدل زن استفاده نمی‌شود (بند ۵).
 */
export type { ArtKind };

const FALLBACK = "var(--color-primary)";

function colorOf(colorId: string): string {
  try {
    return getTerm(colorId).hex ?? FALLBACK;
  } catch {
    /* ترم ناشناخته → رنگ پیش‌فرض برند */
    return FALLBACK;
  }
}

export function ProductArt({
  kind,
  colorId,
  className,
}: {
  kind: ArtKind;
  colorId: string;
  className?: string;
}) {
  return <ArtSilhouette kind={kind} color={colorOf(colorId)} className={className} />;
}

/**
 * قاب آرت محصول — پاسپارتو + نشان برند، هم‌زبان با قاب هیرو.
 * ساختار و قاعدهٔ نشان در `packages/blocks/src/product-art.tsx` توضیح داده شده.
 */
export function ArtFrame({
  kind,
  colorId,
  className,
  mark = true,
}: {
  kind: ArtKind;
  colorId: string;
  className?: string;
  /** نشان برندِ محو — برای تصویرهای بسیار کوچک (سبد) خاموش می‌شود */
  mark?: boolean;
}) {
  return (
    <ArtPlaque kind={kind} color={colorOf(colorId)} className={className} mark={mark} />
  );
}
