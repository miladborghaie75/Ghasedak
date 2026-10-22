"use client";

/**
 * مرز خطای مسیر فروشگاه (گام ۱۰) — آخرین لایهٔ پیش از global-error.
 * فقط متن‌های مشترک lib/copy.ts (منبع یگانه، بند R6)؛ چون صفحه‌های فروشگاه
 * با API حرف می‌زنند، عیب می‌تواند ارتباطی باشد — دکمهٔ تلاش دوباره واقعی است.
 * پیام خطا فقط digest است؛ هیچ جزئیات داخلی به کاربر نشان داده نمی‌شود.
 */
import Link from "next/link";
import { useEffect } from "react";
import { COPY } from "@/lib/copy";
import { Button } from "@/components/ui/Button";

export default function StorefrontError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // digest برای پیگیری در لاگ سرور است؛ رندر به کاربر چیزی نشت نمی‌دهد
    console.error("[storefront] route error", error?.digest ?? "no-digest");
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
      <p className="text-4xl" aria-hidden>
        🧵
      </p>
      <h1 className="mt-4 font-black text-2xl">این صفحه الان باز نشد</h1>
      <p className="mt-3 text-fg/70">
        یک لحظه صبر کن و دوباره تلاش کن؛ اگر تکرار شد، چند دقیقه بعد دوباره سر بزن.
      </p>
      {error?.digest ? (
        <p className="mt-2 font-mono text-xs text-fg/40" dir="ltr">
          {error.digest}
        </p>
      ) : null}
      <div className="mt-8 flex items-center gap-3">
        <Button onClick={reset}>{COPY.retry}</Button>
        <Link
          href="/"
          className="rounded-full border border-line px-5 py-2 text-sm transition hover:bg-primary-soft"
        >
          {COPY.backToStore}
        </Link>
      </div>
    </div>
  );
}
