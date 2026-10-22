import Link from "next/link";
import type { Metadata } from "next";
import { COPY } from "@/lib/copy";

/**
 * قالب مشترک صفحات محتوایی/قانونی فروشگاه.
 * ساختار تیترها (`h2`) برای دسترس‌پذیری و پیمایش با اسکرول استفاده می‌شود.
 */

const NAV = [
  { href: "/about", title: COPY.legal.about },
  { href: "/returns", title: COPY.legal.returns },
  { href: "/shipping", title: COPY.legal.shipping },
  { href: "/terms", title: COPY.legal.terms },
  { href: "/privacy", title: COPY.legal.privacy },
  { href: "/contact", title: COPY.legal.contact },
];

export function LegalShell({
  title,
  intro,
  updated,
  children,
}: {
  title: string;
  intro?: string;
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-4xl px-3 pb-16 pt-6 sm:px-4 sm:pt-10">
      <nav aria-label={COPY.breadcrumb} className="mb-4">
        <Link href="/" className="text-xs text-muted hover:text-primary-strong">
          ← {COPY.backToStore}
        </Link>
      </nav>

      <h1 className="font-display text-2xl text-plum sm:text-3xl">{title}</h1>
      {intro && <p className="mt-3 text-sm leading-7 text-muted">{intro}</p>}
      {updated && <p className="mt-2 text-xs text-muted">آخرین به‌روزرسانی: {updated}</p>}

      <div className="mt-6 flex flex-wrap gap-2 border-y border-line py-3">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className="rounded-full border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:border-primary/40 hover:bg-primary-tint hover:text-primary-strong"
          >
            {n.title}
          </Link>
        ))}
      </div>

      <div className="mt-6 space-y-6">{children}</div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-black text-ink">{title}</h2>
      <div className="space-y-3 text-sm leading-7 text-muted [&_li]:leading-7 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:ps-5">
        {children}
      </div>
    </section>
  );
}

export function meta(title: string, description: string): Metadata {
  return { title, description };
}
