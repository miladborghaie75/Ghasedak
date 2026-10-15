"use client";

/**
 * مرز خطای مسیر پنل (گام ۱۰). لحن ادمین هم صمیمی است (تصمیم مهر ۱۴۰۵) ولی
 * ژست حرفه‌ای‌تر: پیام کوتاه، کد پیگیری، بدون لود جزئیات فنی به صفحه.
 * reset واقعی است؛ سگمنت‌های ادمین همه کلاینت‌محورند و retry معمولاً جواب می‌دهد.
 */
import { useEffect } from "react";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin] route error", error?.digest ?? "no-digest");
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="text-3xl" aria-hidden>
        📋
      </p>
      <h2 className="mt-4 text-xl font-bold">این بخش الان باز نشد</h2>
      <p className="mt-2 text-sm text-fg/70">
        یک لحظه صبر کن و دوباره امتحان کن؛ اگر تکرار شد، کد پیگیری را برای تیم فنی بفرست.
      </p>
      {error?.digest ? (
        <p className="mt-2 font-mono text-xs text-fg/40" dir="ltr">
          {error.digest}
        </p>
      ) : null}
      <button
        onClick={reset}
        className="mt-6 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-fg transition hover:opacity-90"
      >
        تلاش دوباره
      </button>
    </div>
  );
}
