"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";

/** جستجوی واضح: اینپوت همیشه لیبل sr-only + دکمه مشخص دارد */
export function SearchBox({
  autoFocus = false,
  initialValue = "",
  className,
  placeholder = "جستجو در محصولات و برندها...",
}: {
  autoFocus?: boolean;
  initialValue?: string;
  className?: string;
  placeholder?: string;
}) {
  const [q, setQ] = useState(initialValue);
  const router = useRouter();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    router.push(term ? `/search?q=${encodeURIComponent(term)}` : "/search");
  };

  return (
    <form
      role="search"
      onSubmit={submit}
      className={cn("relative w-full", className)}
    >
      <label htmlFor="site-search" className="sr-only">
        جستجو در محصولات
      </label>
      <input
        id="site-search"
        type="search"
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-full border border-line bg-surface ps-11 pe-4 text-sm text-ink outline-none transition-colors placeholder:text-muted/70 focus:border-primary-strong"
      />
      <button
        type="submit"
        aria-label="جستجو"
        className="absolute inset-y-0 start-0 flex w-11 items-center justify-center text-muted hover:text-primary-strong"
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
      </button>
    </form>
  );
}
