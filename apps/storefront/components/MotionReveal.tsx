"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * MotionReveal — reveal سبک بلوک‌های [data-motion=reveal].
 * باگ قدیمی: observer فقط در mount ساخته می‌شد و بعد از ناوبری، بلوک‌های تازه
 * هرگز observe نمی‌شدند → صفحه خالی تا رفرش. علاوه بر رفع آن، حالا یک
 * fallback تایمری هم داریم: اگر IO در محیط اجرا نشود (بعضی webviewها) یا
 * بلوکی داخل viewport بماند، طی چند ثانیهٔ اول به‌اجبار نمایان می‌شود —
 * یعنی محتوا هیچ‌وقت مخفی نمی‌ماند.
 */
export function MotionReveal() {
  const pathname = usePathname();

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      document
        .querySelectorAll('[data-motion="reveal"]')
        .forEach((el) => el.classList.add("motion-in"));
      return;
    }

    const reveal = (el: Element) => el.classList.add("motion-in");

    // ۱) بلوک‌های بالای viewport (بالای فولد) فوراً نمایان — بدون انتظار
    const revealAboveFold = () => {
      document
        .querySelectorAll<HTMLElement>('[data-motion="reveal"]:not(.motion-in)')
        .forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.top < window.innerHeight * 0.92 && r.bottom > 0) reveal(el);
        });
    };
    revealAboveFold();

    // ۲) observer اصلی — بلوک‌های پایین صفحه با اسکرول نمایان می‌شوند
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === "function") {
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              reveal(e.target);
              io?.unobserve(e.target);
            }
          }
        },
        { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
      );
      document
        .querySelectorAll('[data-motion="reveal"]:not(.motion-in)')
        .forEach((el) => io?.observe(el));
    }

    // ۳) fallback دائمی سبک — تضمین نهایی که هیچ بلوکی داخل viewport مخفی نمی‌ماند
    //    حتی اگر IO/rAF در محیط کار نکنند (بعضی webviewها). چون فقط چند ده المان
    //    اندازه‌گیری می‌شود، هزینه‌اش ناچیز است. به‌علاوه listener اسکرول برای
    //    واکنش فوری به اسکرول کاربر.
    const fallback = window.setInterval(revealAboveFold, 600);
    const onScroll = () => revealAboveFold();
    window.addEventListener("scroll", onScroll, { passive: true });

    // ۴) بلوک‌های اضافه‌شدهٔ بعدی (رندر async) را هم پوشش بده
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((n) => {
          if (!(n instanceof HTMLElement)) return;
          if (n.matches?.('[data-motion="reveal"]:not(.motion-in)')) {
            io?.observe(n);
            const r = n.getBoundingClientRect();
            if (r.top < window.innerHeight * 0.92 && r.bottom > 0) reveal(n);
          }
          n.querySelectorAll?.('[data-motion="reveal"]:not(.motion-in)').forEach((el) => {
            io?.observe(el);
          });
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.clearInterval(fallback);
      window.removeEventListener("scroll", onScroll);
      io?.disconnect();
      mo.disconnect();
    };
  }, [pathname]);

  return null;
}
