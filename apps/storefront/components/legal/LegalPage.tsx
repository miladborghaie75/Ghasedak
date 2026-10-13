import Link from "next/link";

/**
 * قالب مشترک صفحات محتوایی فروشگاه (تماس، قوانین، بازگشت کالا، …).
 * یک‌بار طراحی شده تا همه صفحات هم‌وزن و هم‌ساختار باشند.
 */
export function LegalPage({
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
    <div className="mx-auto max-w-3xl px-3 py-8 sm:px-4 sm:py-12">
      <nav aria-label="مسیر" className="mb-4 text-[12px] text-muted">
        <Link href="/" className="hover:text-primary-strong">
          خانه
        </Link>
        <span aria-hidden className="mx-1.5">/</span>
        <span className="text-ink">{title}</span>
      </nav>

      <h1 className="font-display text-3xl text-plum sm:text-4xl">{title}</h1>
      {intro && <p className="mt-3 text-[15px] leading-8 text-muted">{intro}</p>}
      {updated && (
        <p className="mt-2 text-[12px] text-muted/80">
          آخرین به‌روزرسانی: {updated}
        </p>
      )}

      <div className="mt-8 space-y-6 text-[14px] leading-8 text-ink">{children}</div>
    </div>
  );
}

export function LegalSection({
  heading,
  children,
  tone = "plain",
}: {
  heading: string;
  children: React.ReactNode;
  tone?: "plain" | "accent" | "warning";
}) {
  const tones: Record<string, string> = {
    plain: "border-line bg-surface",
    accent: "border-primary-soft bg-primary-tint",
    warning: "border-line bg-surface",
  };
  return (
    <section className={`rounded-card border p-5 shadow-clay-1 sm:p-6 ${tones[tone]}`}>
      <h2 className="mb-2 text-[15px] font-extrabold text-plum">{heading}</h2>
      <div className="space-y-3 text-[14px] leading-8 text-ink">{children}</div>
    </section>
  );
}

export function LegalList({ items, ordered = false }: { items: readonly string[]; ordered?: boolean }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={`space-y-2 ${ordered ? "list-none" : "list-none"}`}>
      {items.map((it, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary-soft" />
          <span>{it}</span>
        </li>
      ))}
    </Tag>
  );
}

/** گام بعدی برای کاربر — هر صفحه محتوایی یک مسیر اقدام دارد */
export function LegalCta({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: { href: string; label: string };
}) {
  return (
    <div className="rounded-blob border border-primary-soft bg-primary-tint p-6 text-center shadow-clay-1">
      <h2 className="font-display text-xl text-plum">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-[14px] leading-8 text-muted">{body}</p>
      <Link
        href={action.href}
        className="mt-4 inline-flex h-12 min-w-40 items-center justify-center rounded-full bg-primary px-7 text-sm font-bold text-on-accent shadow-clay-1 transition-colors hover:bg-primary-press"
      >
        {action.label}
      </Link>
    </div>
  );
}
