"use client";

import { useState } from "react";

/**
 * نشان اعتماد الکترونیکی (اینماد).
 *
 * تصویر اصلی از خودِ سامانه می‌آید: کد رسمیِ صادرشده باید همین‌جا باشد تا
 * سامانه نشان را به شناسنامهٔ کسب‌وکار نسبت دهد؛ `referrerPolicy="origin"`
 * هم عیناً همان چیزی است که کد رسمی می‌خواهد.
 *
 * چرا فالبک محلی؟ روی بعضی شبکه‌ها دامنهٔ trustseal.enamad.ir در دسترس نیست
 * و فعلاً خود سامانه هم برای کد تازه‌صادرشده ۴۰۳ می‌دهد. در آن حالت جای
 * آیکون تصویرِ شکسته، نشانِ رسمی eNAMAD (فایل خودِ سایت) نمایش داده می‌شود
 * و لینک به شناسنامهٔ کسب‌وکار سر جایش می‌ماند.
 */
const HREF =
  "https://trustseal.enamad.ir/?id=8443966&Code=Ts1ukgqIv9Qa9Kmapjmv8ohTbtavNXBv";
const SEAL_SRC =
  "https://trustseal.enamad.ir/logo.aspx?id=8443966&Code=Ts1ukgqIv9Qa9Kmapjmv8ohTbtavNXBv";

export function EnamadSeal() {
  const [unavailable, setUnavailable] = useState(false);

  return (
    <a
      href={HREF}
      target="_blank"
      rel="noopener"
      referrerPolicy="origin"
      aria-label="نشان اعتماد الکترونیکی (اینماد) — مشاهدهٔ مجوز در سامانه"
      className="inline-flex min-h-11 items-center justify-center rounded-xl p-1 transition-opacity hover:opacity-90"
    >
      {unavailable ? (
        <span className="flex flex-col items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1.5">
          <img
            src="/enamad-logo.png"
            alt="نماد اعتماد الکترونیکی (اینماد)"
            width={112}
            height={39}
            loading="lazy"
            decoding="async"
            className="h-auto w-28 object-contain"
          />
          <span className="text-[9px] leading-3 text-muted">نماد اعتماد الکترونیکی</span>
        </span>
      ) : (
        <img
          src={SEAL_SRC}
          alt="نشان اعتماد الکترونیکی (اینماد)"
          referrerPolicy="origin"
          width={80}
          height={80}
          loading="lazy"
          decoding="async"
          className="h-20 w-20 cursor-pointer object-contain"
          {...{ code: "Ts1ukgqIv9Qa9Kmapjmv8ohTbtavNXBv" }}
          onError={() => setUnavailable(true)}
        />
      )}
    </a>
  );
}
