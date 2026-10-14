"use client";

import { Button } from "./Button";

/**
 * حالت «داده در دسترس نیست» — وقتی کاتالوگ لود نشده ولی کاربر دادهٔ محلی
 * دارد (سبد/علاقه‌مندی). صادقانه می‌گوید «نمایش ندادیم»، نه «خالی است»:
 * ادعای خالی‌بودن سبدِ پُر، خطای UX است.
 *
 * کش کاتالوگ per-load است؛ پس رفرش صفحه = تلاش دوبارهٔ واقعی (بدون دکمهٔ
 * بی‌اثر). رنگ و گردی از توکن‌ها می‌آید تا در دو تم درست بماند.
 */
export function DataUnavailable({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-4 rounded-card border border-dashed border-line bg-surface px-6 py-14 text-center"
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-primary-tint text-primary">
        <svg
          viewBox="0 0 24 24"
          className="size-7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden
        >
          <path d="M12 8.5v4.5" strokeLinecap="round" />
          <circle cx="12" cy="16.5" r="0.9" fill="currentColor" stroke="none" />
          <path
            d="M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <p className="text-sm font-bold text-ink">{title}</p>
      {hint && <p className="max-w-sm text-[13px] leading-7 text-muted">{hint}</p>}
      <Button variant="secondary" onClick={() => window.location.reload()}>
        تلاش دوباره
      </Button>
    </div>
  );
}
