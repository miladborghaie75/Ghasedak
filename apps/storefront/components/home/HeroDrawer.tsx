"use client";

import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * HeroDrawer — هیرو با عکس واقعی کشوی لباس زیر (بند ۵: عکس محصول، بدون مدل).
 * ۴ پین روی خانه‌های کشو: سوتین/شورت/ست/گن (بند ۸ — کشو = ناوبری).
 * دسکتاپ: هاور → تولتیپ متن کوتاه دسته؛ کلیک → صفحه دسته.
 * موبایل: پین‌ها چشمک‌زن (نشانه تاچ‌پذیری)؛ تاچ → صفحه دسته.
 *
 * fix تولتیپ: در RTL باید از left فیزیکی + translateX استفاده شود، نه
 * start-* منطقی — ترکیب قبلی تولتیپ را به گوشه صفحه می‌برد.
 * تولتیپ روی لایه جدا از overflow-hidden رندر می‌شود تا بریده نشود.
 */

interface Pin {
  id: string;
  slug: string;
  name: string;
  blurb: string;
  /** مختصات درصدی روی تصویر (چپ/بالا) */
  x: number;
  y: number;
  /** جهت تولتیپ — بالا یا پایین پین (بسته به نزدیکی به لبه بالا) */
  side: "above" | "below";
}

const PINS: Pin[] = [
  { id: "bra", slug: "bra", name: "سوتین", blurb: "فنردار و بدون فنر", x: 40, y: 38, side: "above" },
  { id: "set", slug: "set", name: "ست لباس زیر", blurb: "هماهنگ و ظریف", x: 78, y: 27, side: "below" },
  { id: "panty", slug: "panty", name: "شورت", blurb: "نخی، بدون درز", x: 65, y: 62, side: "above" },
  { id: "shapewear", slug: "shapewear", name: "گن", blurb: "فرم‌دهی ملایم", x: 84, y: 72, side: "above" },
];

export function HeroDrawer() {
  return (
    <section
      aria-labelledby="hero-title"
      className="mx-auto max-w-7xl px-3 pt-4 sm:px-4"
    >
      <div className="relative overflow-hidden rounded-blob border border-line bg-gradient-to-b from-primary-tint to-bg shadow-clay-1">
        <div className="grid items-center gap-6 p-5 sm:p-8 lg:grid-cols-2 lg:gap-4 lg:p-12">
          {/* متن هیرو */}
          <div className="order-2 text-center lg:order-1 lg:text-start">
            <p className="mb-3 text-sm font-bold text-primary-strong">
              انتخابی آسان برای هر سایز
            </p>
            <h1
              id="hero-title"
              className="font-display text-3xl leading-[1.35] text-plum sm:text-4xl lg:text-[42px]"
            >
              انتخاب راحت‌تر، خرید مطمئن‌تر 💜
            </h1>
            <p className="mt-3 text-sm leading-8 text-muted sm:text-base">
              از سوتین‌های راحت و جدید تا ست‌های فانتزی و لباس خواب‌های دلنشین.
              روی هر چیزی که توی کشو می‌بینی بزن و همین‌جا شروع کن.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              <Link
                href="/need"
                className="inline-flex h-12 items-center rounded-full bg-primary px-6 text-sm font-bold text-white shadow-clay-1 transition-all hover:bg-primary-press hover:shadow-clay-2 active:scale-[0.98]"
              >
                پیشنهاد بگیر
              </Link>
              <Link
                href="/guides/size"
                className="inline-flex h-12 items-center rounded-full border border-line bg-surface px-6 text-sm font-bold text-primary-strong shadow-clay-1 transition-all hover:bg-primary-tint"
              >
                راهنمای سایز
              </Link>
            </div>
          </div>

          {/* تصویر کشو + پین‌ها */}
          <div className="relative order-1 lg:order-2">
            <div className="relative mx-auto w-full max-w-lg">
              {/* تصویر در لایه کلیپ خودش */}
              <div className="overflow-hidden rounded-blob border border-line shadow-clay-2">
                <Image
                  src="/images/hero-drawer.jpg"
                  alt="کشوی مرتب لباس زیر با خانه‌های سوتین، شورت، ست و گن"
                  width={1600}
                  height={900}
                  priority
                  sizes="(max-width: 1024px) 100vw, 560px"
                  className="h-auto w-full"
                />
              </div>

              {/* پین‌ها + تولتیپ — بیرون لایه کلیپ تا بریده نشوند */}
              {PINS.map((pin) => (
                <CategoryPin key={pin.id} pin={pin} />
              ))}
            </div>
          </div>
        </div>
        <div aria-hidden className="pointer-events-none absolute -start-20 -top-20 size-56 rounded-full bg-primary-soft/60 blur-2xl" />
      </div>
    </section>
  );
}

function CategoryPin({ pin }: { pin: Pin }) {
  return (
    <Link
      href={`/c/${pin.slug}`}
      aria-label={`خرید ${pin.name} — ${pin.blurb}`}
      style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
      className="group absolute z-10 -translate-x-1/2 -translate-y-1/2"
    >
      {/* نقطه پین — زیر lg چشمک‌زن تا تاچ‌پذیری مشخص شود */}
      <span
        className={cn(
          "animate-pin-pulse relative flex size-7 items-center justify-center rounded-full border-2 border-white bg-primary shadow-clay-2 transition-transform duration-150",
          "hover:scale-110 focus-visible:scale-110",
        )}
        aria-hidden
      >
        <span className="size-2 rounded-full bg-white" />
      </span>

      {/* تولتیپ — left فیزیکی ۵۰٪ + translateX؛ هرگز از start/end منطقی استفاده نمی‌شود */}
      <span
        role="presentation"
        style={{ left: "50%", transform: "translateX(-50%)" }}
        className={cn(
          "pointer-events-none absolute z-20 w-max max-w-[220px] rounded-2xl bg-plum px-3 py-1.5 text-center text-[12px] leading-5 text-white opacity-0 shadow-clay-2 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100",
          pin.side === "above" ? "bottom-full mb-2" : "top-full mt-2",
        )}
      >
        <strong className="font-extrabold">{pin.name}</strong>
        <span className="mx-1.5 opacity-40">|</span>
        <span className="font-medium opacity-90">{pin.blurb}</span>
      </span>
    </Link>
  );
}
