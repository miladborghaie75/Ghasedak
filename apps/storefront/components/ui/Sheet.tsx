"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

/**
 * Bottom Sheet موبایل / Modal دسکتاپ — یک کامپوننت، دو رفتار واکنش‌گرا.
 * فوکوس را داخل نگه می‌دارد، با Escape بسته می‌شود و اسکرول پس‌زمینه را قفل می‌کند.
 * ASSUMPTION: dialog جزئی از React 19 است (نسخه canary/19 پایدار).
 */
interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function Sheet({ open, onClose, title, children, className }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && el) {
        const focusables = el.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    // فوکوس اولیه
    requestAnimationFrame(() => {
      el?.querySelector<HTMLElement>("button, input, [tabindex]")?.focus();
    });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-plum/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative w-full max-w-lg rounded-t-blob bg-surface shadow-clay-3 sm:rounded-blob",
          "max-h-[88vh] overflow-y-auto",
          "animate-[sheet-up_.28s_cubic-bezier(.2,.9,.3,1)]",
          className,
        )}
      >
        {/* دستگیره — فقط موبایل */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur sm:px-5">
          <span aria-hidden className="mx-auto size-1.5 rounded-full bg-line sm:hidden" />
          <h2 className="absolute start-1/2 top-1/2 -translate-y-1/2 translate-x-1/2 text-sm font-extrabold text-ink sm:static sm:translate-x-0 sm:text-base">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن"
            className="relative ms-auto flex size-11 items-center justify-center rounded-full text-muted hover:bg-primary-tint hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="px-4 pb-8 pt-4 sm:px-5">{children}</div>
      </div>
    </div>
  );
}
