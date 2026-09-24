import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { guides } from "@/lib/guides-data";

export function generateStaticParams() {
  return Object.keys(guides).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const g = guides[slug];
  return g ? { title: g.title, description: g.intro } : {};
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const g = guides[slug];
  if (!g) notFound();

  return (
    <article className="mx-auto max-w-2xl px-3 py-8 sm:px-4">
      <h1 className="font-display text-3xl text-plum">{g.title}</h1>
      <p className="mt-2 text-[14px] leading-8 text-muted">{g.intro}</p>

      <div className="mt-6 flex flex-col gap-4">
        {g.sections.map((s) => (
          <section key={s.h} className="rounded-card border border-line bg-surface p-5 shadow-clay-1">
            <h2 className="text-[15px] font-extrabold text-ink">{s.h}</h2>
            <p className="mt-2 text-[13px] leading-8 text-muted">{s.p}</p>
          </section>
        ))}
      </div>

      <div className="mt-6 rounded-card bg-primary-tint p-5 text-center">
        <p className="text-[13px] font-bold text-ink">آماده انتخاب سایز هستید؟</p>
        <Link href="/c/bra" className="mt-3 inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-bold text-white shadow-clay-1 hover:bg-primary-press">
          دیدن سوتین‌ها
        </Link>
      </div>
    </article>
  );
}
