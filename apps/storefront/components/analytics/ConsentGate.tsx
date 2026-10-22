"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";
import {
  captureUtmFirstTouch,
  flushTrackQueue,
  getConsentDecision,
  saveConsentDecision,
  trackVisit,
  type ConsentDecision,
} from "@/lib/analytics";

/**
 * دروازهٔ رضایت (گام ۱۵-۱/۱۵-۲) — یک کامپوننت، دو نقش:
 *
 * ۱) بنر تصمیم: فقط تا وقتی کاربر انتخاب نکرده نشان می‌دهد؛ ناوبری را
 *    نمی‌بندد (بدون مودال اجباری — ریسک ۲ گام ۱۵). تصمیم هم در
 *    localStorage می‌نشیند و هم در ConsentRecord سرور.
 *    از تصمیم تازهٔ D-5 (۲۰۲۶-۱۰-۱۸) این بنر فقط دروازهٔ GA4 است —
 *    شمارش بازدید first-party سرور خودمان همیشه روشن است و به رضایت وصل نیست.
 * ۲) لود GA4: اسکریپت فقط «پس از رضایت» رندر می‌شود — یعنی بدون رضایت
 *    حتی یک بایت از گوگل دانلود نمی‌شود. پس از لود، صف رویدادها flush می‌شود.
 */
export function ConsentGate() {
  const [decision, setDecision] = useState<ConsentDecision | null>(null);
  const [decided, setDecided] = useState(false); // بعد از تعامل، بنر فوراً می‌رود

  useEffect(() => {
    captureUtmFirstTouch(); // ورود اول — هر صفحه ممکن است نقطهٔ ورود باشد
    setDecision(getConsentDecision());
  }, []);

  // شمارش بازدید first-party (گام ۱۵-۶) — همیشه‌روشن (تصمیم تازهٔ D-5):
  // شمارش به رضایت وصل نیست؛ فقط GA4 پشت بنر می‌ماند.
  // gtag خودش page_view می‌فرستد (history wrapper داخلی‌اش)؛ اینجا فقط
  // شمارندهٔ سرور خودمان صدا می‌شود تا GA4 دوباره‌شماری نکند.
  const pathname = usePathname();
  useEffect(() => {
    trackVisit(pathname);
  }, [pathname]);

  const choose = (d: ConsentDecision) => {
    saveConsentDecision(d);
    setDecision(d);
    setDecided(true);
  };

  const mid = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID ?? "";

  return (
    <>
      {/* اسکریپت فقط پس از رضایت — قاعدهٔ سخت گام ۱۵ */}
      {decision === "granted" && mid ? (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(mid)}`} strategy="afterInteractive" />
          <Script id="ga4-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('js',new Date());gtag('config','${mid}');`}
          </Script>
        </>
      ) : null}

      {/* رویدادهایی که قبل از آماده‌شدن gtag صف شده‌اند — بعد از لود اسکریپت شلیک می‌شوند */}
      {decision === "granted" ? (
        <Script id="ga4-flush" strategy="afterInteractive" onLoad={() => flushTrackQueue()} />
      ) : null}

      {/* بنر تصمیم — تصمیم‌داده فقط همین بنر را می‌بندد، نه مسیر خرید را */}
      {decision === null && !decided ? (
        <div
          role="region"
          aria-label="رضایت آنالیتیکس"
          className="fixed inset-x-3 bottom-3 z-40 rounded-card border border-line bg-surface/97 p-4 shadow-clay-2 backdrop-blur sm:inset-x-auto sm:end-6 sm:max-w-sm print:hidden"
        >
          <p className="text-[13px] font-bold text-ink">توضیح کوتاه دربارهٔ آمار</p>
          <p className="mt-1 text-[12px] leading-6 text-muted">
            بازدیدهای این سایت را خودمان می‌شماریم و همیشه روشن است؛ این پرسش فقط
            دربارهٔ Google Analytics است — با اجازهٔ تو بهتر می‌فهمیم کدام صفحه‌ها
            بیشتر دیده می‌شوند. نه زدنی هیچ‌چیز به گوگل نمی‌رود و خریدت هم هیچ
            فرقی نمی‌کند.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => choose("granted")}
              className="h-10 flex-1 rounded-full bg-primary px-4 text-[13px] font-bold text-on-accent"
            >
              اجازه می‌دهم
            </button>
            <button
              type="button"
              onClick={() => choose("denied")}
              className="h-10 flex-1 rounded-full border border-line bg-surface px-4 text-[13px] font-bold text-ink"
            >
              نه، ممنون
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
