"use client";

/**
 * ThemeToggle ادمین — بند ۵۳/۵۵: کنترل روز/شب/سیستم، دسترس‌پذیر (radio group)،
 * همگام‌سازی زنده با prefers-color-scheme هنگام حالت سیستم.
 */
import { useCallback, useEffect, useState } from "react";
import { readAdminThemePref } from "./theme-init";

const OPTIONS: Array<{ value: "light" | "dark" | "system"; label: string }> = [
  { value: "light", label: "روز" },
  { value: "dark", label: "شب" },
  { value: "system", label: "سیستم" },
];

function applyPreference(pref: "light" | "dark" | "system") {
  try {
    if (pref === "system") localStorage.removeItem("ghasedak-admin-theme");
    else localStorage.setItem("ghasedak-admin-theme", pref);
  } catch {}
  const sysDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = pref === "system" ? (sysDark ? "dark" : "light") : pref;
  document.documentElement.setAttribute("data-theme", resolved);
}

export function AdminThemeToggle() {
  const [pref, setPref] = useState<"light" | "dark" | "system">("system");

  useEffect(() => {
    setPref(readAdminThemePref());
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readAdminThemePref() === "system") applyPreference("system");
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
      aria-label="حالت نمایش ادمین (روز، شب یا سیستم)"
      className="flex items-center gap-0.5 rounded-lg border border-line p-0.5"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={pref === o.value}
          onClick={() => select(o.value)}
          className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
            pref === o.value
              ? "bg-primary text-on-accent"
              : "text-muted hover:bg-primary-soft hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
