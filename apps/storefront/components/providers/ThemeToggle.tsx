"use client";

/**
 * ThemeToggle — بند ۵۳: کنترل روز/شب/سیستم، دسترس‌پذیر (radio group با aria-checked)،
 * همگام‌سازی زنده با تغییر prefers-color-scheme هنگام حالت سیستم، بدون layout shift.
 */
import { useCallback, useEffect, useState } from "react";
import { readThemePref } from "./theme-init";

const OPTIONS: Array<{ value: "light" | "dark" | "system"; label: string }> = [
  { value: "light", label: "روز" },
  { value: "dark", label: "شب" },
  { value: "system", label: "سیستم" },
];

function applyPreference(pref: "light" | "dark" | "system") {
  try {
    if (pref === "system") localStorage.removeItem("ghasedak-theme");
    else localStorage.setItem("ghasedak-theme", pref);
  } catch {}
  const sysDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = pref === "system" ? (sysDark ? "dark" : "light") : pref;
  document.documentElement.setAttribute("data-theme", resolved);
}

export function ThemeToggle() {
  const [pref, setPref] = useState<"light" | "dark" | "system">("system");

  useEffect(() => {
    setPref(readThemePref());
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      // اگر کاربر روی «سیستم» است، تغییر سیستم فوراً اعمال شود
      if (readThemePref() === "system") applyPreference("system");
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const select = useCallback((next: "light" | "dark" | "system") => {
    setPref(next);
    applyPreference(next);
  }, []);

  return (
    <div
      role="radiogroup"
      aria-label="حالت نمایش (روز، شب یا سیستم)"
      className="flex items-center gap-0.5 rounded-full border border-line bg-surface/95 p-0.5 shadow-clay-1"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={pref === o.value}
          onClick={() => select(o.value)}
          className={`rounded-full px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
            pref === o.value
              ? "bg-primary text-on-accent"
              : "text-muted hover:bg-primary-tint hover:text-primary-strong"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
