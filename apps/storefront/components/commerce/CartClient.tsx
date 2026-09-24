"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useCart } from "@/components/providers/CartProvider";
import { ProductArt, type ArtKind } from "./ProductArt";
import { Price } from "@/components/ui/Price";
import { faNum } from "@/lib/format";
import { getTerm } from "@/lib/attributes";
import { getAllProductsV2 } from "@/lib/catalog-repo";
import type { ProductV2, VariantV2 } from "@/lib/catalog";

/** آستانه ارسال رایگان — ثابت نمایشی؛ با بک‌اند از تنظیمات می‌آید */
const FREE_SHIPPING_THRESHOLD = 1_500_000;

interface Detail {
  variant: VariantV2;
  product: ProductV2;
  qty: number;
}

/** برچسب تنوع: رنگ + سایز (+ کاپ/فنر اگر دارد) */
function variantLabel(v: VariantV2): string {
  const parts = [getTerm(v.colorId).label, `سایز ${getTerm(v.sizeId).label}`];
  const extras = v.optionIds
    .filter((id) => id.startsWith("cup-"))
    .map((id) => `کاپ ${getTerm(id).label}`);
  return [...parts, ...extras].join(" · ");
}

export function CartClient() {
  const { lines, setQty, removeLine, ready } = useCart();

  const detailed = useMemo<Detail[]>(() => {
    const byId = new Map(getAllProductsV2().flatMap((p) => p.variants.map((v) => [v.id, { v, p }] as const)));
    const result: Detail[] = [];
    for (const line of lines) {
      const hit = byId.get(line.variantId);
      if (hit) result.push({ variant: hit.v, product: hit.p, qty: line.qty });
    }
    return result;
  }, [lines]);

  if (!ready) {
    return <p className="py-16 text-center text-sm text-muted">در حال بارگذاری سبد…</p>;
  }

  if (detailed.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-card border border-dashed border-line bg-surface px-6 py-16 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-primary-tint text-primary">
          <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M6 8h12l-1 12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 8z" strokeLinejoin="round" />
            <path d="M9 10V7a3 3 0 0 1 6 0v3" strokeLinecap="round" />
          </svg>
        </span>
        <p className="text-sm font-bold text-ink">سبد خرید شما خالی است</p>
        <p className="max-w-xs text-[13px] leading-7 text-muted">
          از کشوی صفحه اصلی شروع کنید یا دسته‌ها را ببینید.
        </p>
        <Link
          href="/"
          className="inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-bold text-white shadow-clay-1 hover:bg-primary-press"
        >
          رفتن به فروشگاه
        </Link>
      </div>
    );
  }

  const unitPrice = (d: Detail) => d.variant.salePrice ?? d.variant.price;
  const subtotal = detailed.reduce((s, d) => s + unitPrice(d) * d.qty, 0);
  const savings = detailed.reduce(
    (s, d) => s + (d.variant.salePrice != null ? (d.variant.price - d.variant.salePrice) * d.qty : 0),
    0,
  );
  const remaining = FREE_SHIPPING_THRESHOLD - subtotal;

  return (
    <div className="flex flex-col gap-4">
      {/* نوار پیشرفت ارسال رایگان — بازخورد مثبت، نه فشار */}
      {remaining > 0 && (
        <div className="rounded-card border border-line bg-primary-tint/70 p-3.5">
          <p className="text-[13px] font-bold text-ink">
            {faNum(remaining)} تومان تا ارسال رایگان
          </p>
          <div
            role="progressbar"
            aria-valuenow={Math.min(100, Math.round((subtotal / FREE_SHIPPING_THRESHOLD) * 100))}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="پیشرفت تا ارسال رایگان"
            className="mt-2 h-2 overflow-hidden rounded-full bg-surface"
          >
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.min(100, (subtotal / FREE_SHIPPING_THRESHOLD) * 100)}%` }}
            />
          </div>
        </div>
      )}
      {remaining <= 0 && (
        <p className="rounded-card bg-success/10 p-3.5 text-[13px] font-bold text-success">
          ارسال این سفارش رایگان است 🎉
        </p>
      )}

      {/* خطوط سبد */}
      <ul className="flex flex-col gap-3">
        {detailed.map((d) => (
          <li
            key={d.variant.id}
            className="flex gap-3 rounded-card border border-line bg-surface p-3 shadow-clay-1"
          >
            <Link href={`/p/${d.product.slug}`} className="size-24 shrink-0 rounded-xl bg-primary-tint p-1.5">
              <ProductArt kind={d.product.category as ArtKind} colorId={d.variant.colorId} />
            </Link>
            <div className="flex min-w-0 flex-1 flex-col">
              <Link href={`/p/${d.product.slug}`} className="clamp-2 text-[13px] font-bold text-ink hover:text-primary-strong">
                {d.product.name}
              </Link>
              <p className="mt-1 text-[11px] text-muted">{variantLabel(d.variant)}</p>
              <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                <QtyStepper qty={d.qty} onChange={(q) => setQty(d.variant.id, q)} />
                <Price price={unitPrice(d) * d.qty} compareAtPrice={d.variant.salePrice != null ? d.variant.price * d.qty : undefined} size="sm" />
              </div>
            </div>
            <button
              type="button"
              onClick={() => removeLine(d.variant.id)}
              aria-label={`حذف ${d.product.name} از سبد`}
              className="self-start rounded-full p-2 text-muted hover:bg-primary-tint hover:text-error"
            >
              <svg viewBox="0 0 24 24" className="size-4.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                <path d="M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </li>
        ))}
      </ul>

      {/* جمع‌ها */}
      <div className="rounded-card border border-line bg-surface p-4 shadow-clay-1">
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted">جمع کالاها</span>
          <span className="font-bold text-ink tnum">{faNum(subtotal)} تومان</span>
        </div>
        {savings > 0 && (
          <div className="mt-2 flex items-center justify-between text-[13px]">
            <span className="text-muted">سود شما از خرید</span>
            <span className="font-bold text-success tnum">{faNum(savings)} تومان</span>
          </div>
        )}
        <div className="mt-2 flex items-center justify-between text-[13px]">
          <span className="text-muted">هزینه ارسال</span>
          <span className="text-[13px] text-muted">
            {remaining > 0 ? "در مرحله بعد محاسبه می‌شود" : "رایگان"}
          </span>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
          <span className="text-sm font-extrabold text-ink">مبلغ قابل پرداخت</span>
          <Price price={subtotal} size="md" />
        </div>
        <Link
          href="/checkout"
          className="mt-4 flex h-12 items-center justify-center rounded-full bg-primary text-sm font-bold text-white shadow-clay-1 transition-all hover:bg-primary-press hover:shadow-clay-2 active:scale-[0.98]"
        >
          ادامه خرید و پرداخت
        </Link>
        <p className="mt-2.5 text-center text-[11px] leading-5 text-muted">
          نیازی به ثبت‌نام نیست — به‌عنوان مهمان ادامه دهید.
        </p>
      </div>
    </div>
  );
}

function QtyStepper({ qty, onChange }: { qty: number; onChange: (q: number) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-line">
      <button
        type="button"
        onClick={() => onChange(qty - 1)}
        aria-label="کاهش تعداد"
        className="flex size-9 items-center justify-center rounded-full text-ink hover:bg-primary-tint"
      >
        −
      </button>
      <span aria-live="polite" className="min-w-7 text-center text-[13px] font-bold text-ink tnum">
        {faNum(qty)}
      </span>
      <button
        type="button"
        onClick={() => onChange(qty + 1)}
        aria-label="افزایش تعداد"
        className="flex size-9 items-center justify-center rounded-full text-ink hover:bg-primary-tint"
      >
        +
      </button>
    </div>
  );
}
