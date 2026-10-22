import Link from "next/link";
import type { ReactNode } from "react";
import type {
  SiteContentBlock,
  SiteContentPage,
  SiteContentParagraph,
  SiteContentSegment,
} from "@ghasedak/contracts";
import { LegalShell, Section } from "./LegalShell";

/**
 * چیدمانِ پیش‌فرضِ صفحه‌های محتوایی/قانونی — از روی **محتوای مشترک**.
 *
 * چرا این‌طور؟ چون همان متنی که اینجا رندر می‌شود، مبنای ساختِ صفحهٔ CMS
 * هم هست (صفحه‌ساز روی «ساخت صفحه از محتوای فعلی» همین را تبدیل می‌کند).
 * یعنی متنِ سایت و متنِ صفحه‌ساز یکی هستند — نه دو کپی که یک روز از هم
 * جدا می‌افتند.
 */
export function SiteContentView({
  content,
  title,
}: {
  content: SiteContentPage;
  title: string;
}) {
  return (
    <LegalShell title={title} intro={content.intro} updated={content.updated}>
      {content.sections.map((section, si) =>
        section.title ? (
          <Section key={`s-${si}`} title={section.title}>
            {section.blocks.map((block, bi) => renderBlock(block, `b-${si}-${bi}`))}
          </Section>
        ) : (
          // بخشِ بی‌تیتر (مثل یادداشت پایانی) — تیترِ خالی ساخته نمی‌شود
          <div key={`s-${si}`}>
            {section.blocks.map((block, bi) => renderBlock(block, `b-${si}-${bi}`))}
          </div>
        ),
      )}
    </LegalShell>
  );
}

/** رندرِ یک بند */
function renderBlock(block: SiteContentBlock, key: string): ReactNode {
  if (block.kind === "list") {
    return (
      <ul key={key}>
        {block.items.map((item, i) => (
          <li key={`${key}-${i}`}>{renderParagraph(item)}</li>
        ))}
      </ul>
    );
  }
  if (block.kind === "note") {
    return (
      <p
        key={key}
        className="rounded-2xl border border-line bg-surface p-4 text-xs leading-6 text-muted"
      >
        {renderParagraph(block.text)}
      </p>
    );
  }
  return <p key={key}>{renderParagraph(block.text)}</p>;
}

/** رندرِ یک بندِ متنی — تکه‌های پیوندی و برجسته جدا رندر می‌شوند */
function renderParagraph(paragraph: SiteContentParagraph): ReactNode {
  const segments = typeof paragraph === "string" ? [{ text: paragraph }] : paragraph;
  return segments.map((segment, i) => renderSegment(segment, `seg-${i}`));
}

/** رندرِ یک تکهٔ متن */
function renderSegment(segment: SiteContentSegment, key: string): ReactNode {
  const isInternal = !!segment.href && segment.href.startsWith("/");
  const linkClass = [
    "text-primary-strong hover:underline",
    segment.strong ? "font-semibold" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (segment.href) {
    if (isInternal) {
      return (
        <Link key={key} href={segment.href} className={linkClass} dir={segment.ltr ? "ltr" : undefined}>
          {segment.text}
        </Link>
      );
    }
    return (
      <a
        key={key}
        href={segment.href}
        className={linkClass}
        dir={segment.ltr ? "ltr" : undefined}
        {...(segment.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {segment.text}
      </a>
    );
  }

  if (segment.muted) {
    return (
      <span key={key} className="ms-2 text-xs text-muted">
        {segment.text}
      </span>
    );
  }
  if (segment.strong) {
    return (
      <span key={key} className="font-medium text-ink">
        {segment.text}
      </span>
    );
  }
  return <span key={key}>{segment.text}</span>;
}
