import Link from "next/link";
import { clsx } from "clsx";
import { CONTENT_PAGE_COPY, CONTENT_PAGE_NAV, parseBody, type ContentLine, type ContentSpan } from "@ghasedak/contracts";
import type { CmsBlockProps } from "./types";
import { pItems, pStr } from "./types";

/**
 * چیدمانِ صفحه‌های محتوایی/قانونی — **تنها** پیاده‌سازیِ این چیدمان.
 *
 * اصل مهم: هم صفحهٔ ایستا (متنِ ثابتِ کد) و هم صفحهٔ صفحه‌ساز (بلوک
 * `CONTENT_PAGE`) از همین کامپوننت رندر می‌شوند. پس «صفحهٔ درباره ما در پنل با
 * سایت فرق دارد» از این پس از نظر ساختاری ناممکن است: هر دو همین‌اند.
 *
 * متنِ هر بخش با نشانه‌گذاریِ `@ghasedak/contracts/site-content/markup` نوشته
 * می‌شود (هر خط یک بند؛ `- ` فهرست؛ `> ` یادداشت؛ `[متن](پیوند)` و `**متن**`)
 * و همین‌جا به گره‌های ریاکت تبدیل می‌شود — بدون هیچ HTML خام.
 */

export interface ContentPageSectionInput {
  title?: string;
  /** متنِ نشانه‌گذاری‌شدهٔ بخش */
  body: string;
}

export function ContentPageView({
  title,
  intro,
  updated,
  sections,
}: {
  /** `h1` صفحه — در فروشگاه عنوانِ صفحه، در صفحه‌ساز عنوانِ صفحهٔ CMS */
  title: string;
  intro?: string;
  updated?: string;
  sections: ContentPageSectionInput[];
}) {
  return (
    <div className="mx-auto max-w-4xl px-3 pb-16 pt-6 sm:px-4 sm:pt-10">
      <nav aria-label={CONTENT_PAGE_COPY.breadcrumb} className="mb-4">
        <Link href="/" className="text-xs text-app-muted hover:text-app-primary-strong">
          ← {CONTENT_PAGE_COPY.backToStore}
        </Link>
      </nav>

      {title && (
        <h1
          className="text-2xl text-app-plum sm:text-3xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </h1>
      )}
      {intro && (
        <p className="mt-3 text-sm leading-7 text-app-muted" data-cms-field="intro">
          {intro}
        </p>
      )}
      {updated && <p className="mt-2 text-xs text-app-muted">{CONTENT_PAGE_COPY.updatedPrefix} {updated}</p>}

      {/* نوارِ پیمایشِ همنشین‌ها — بازدیدکننده از هر صفحهٔ محتوایی به بقیه می‌رود */}
      <div className="mt-6 flex flex-wrap gap-2 border-y border-app-line py-3">
        {CONTENT_PAGE_NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className="rounded-full border border-app-line px-3 py-1.5 text-xs text-app-muted transition-colors hover:border-app-primary/40 hover:bg-app-primary-tint hover:text-app-primary-strong"
          >
            {n.title}
          </Link>
        ))}
      </div>

      <div className="mt-6 space-y-6">
        {sections.map((section, si) => (
          <section key={`s-${si}`}>
            {section.title?.trim() ? (
              <h2 className="mb-2 text-base font-black text-app-ink">{section.title}</h2>
            ) : null}
            <div className="space-y-3 text-sm leading-7 text-app-muted [&_li]:leading-7 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:ps-5">
              {renderLines(parseBody(section.body ?? ""), si)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * خطوطِ نشانه‌گذاری‌شده → گره؛ اعضای پشت‌سرهمِ فهرست در یک `ul` جمع می‌شوند.
 *
 * هر خط `data-cms-section`/`data-cms-line` و `data-cms-field="sections"` می‌گیرد
 * تا بومِ صفحه‌ساز بتواند همان خط را درجا ویرایش‌پذیر کند و پنل بداند ویرایش
 * مالِ کدام خط از کدام بخش است. در سایتِ منتشرشده این attributeها بی‌اثرند؛
 * همان کاری که `data-cms-field` پاراگرافِ معرفی از قبل می‌کرد.
 */
function renderLines(lines: ContentLine[], sectionIndex: number): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  /** هر ورودی = تکه‌های یک `<li>` + شمارهٔ اصلیِ همان خط */
  let list: Array<{ spans: ContentSpan[]; index: number }> = [];

  const flush = (key: string) => {
    if (list.length === 0) return;
    const items = list;
    list = [];
    nodes.push(
      <ul key={key}>
        {items.map(({ spans, index }, i) => (
          <li
            key={`${key}-${i}`}
            data-cms-field="sections"
            data-cms-section={sectionIndex}
            data-cms-line={index}
          >
            {spans.map((span, j) => renderSpan(span, `${key}-${i}-${j}`))}
          </li>
        ))}
      </ul>,
    );
  };

  lines.forEach((line, i) => {
    if (line.kind === "li") {
      list.push({ spans: line.spans, index: i });
      return;
    }
    flush(`l-${i}`);
    const key = `l-${i}`;
    const children = line.spans.map((span, j) => renderSpan(span, `${key}-${j}`));
    const editable = {
      "data-cms-field": "sections",
      "data-cms-section": sectionIndex,
      "data-cms-line": i,
    } as const;
    nodes.push(
      line.kind === "note" ? (
        <p
          key={key}
          {...editable}
          className="rounded-2xl border border-app-line bg-app-surface p-4 text-xs leading-6 text-app-muted"
        >
          {children}
        </p>
      ) : (
        <p key={key} {...editable}>
          {children}
        </p>
      ),
    );
  });
  flush("last");
  return nodes;
}

/** یک تکهٔ متن — پیوندِ داخلی با `Link`، بیرونی در تب تازه، شماره/ایمیل چپ‌به‌راست */
function renderSpan(span: ContentSpan, key: string): React.ReactNode {
  const href = span.href ?? "";
  const isInternal = href.startsWith("/");
  const isExternal = /^https?:\/\//.test(href);
  const ltr = /^(tel:|mailto:|https?:\/\/)/.test(href);
  const linkClass = clsx(
    "text-app-primary-strong hover:underline",
    span.strong && "font-semibold",
  );

  if (href) {
    if (isInternal) {
      return (
        <Link key={key} href={href} className={linkClass} dir={ltr ? "ltr" : undefined}>
          {span.text}
        </Link>
      );
    }
    return (
      <a
        key={key}
        href={href}
        className={linkClass}
        dir={ltr ? "ltr" : undefined}
        {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {span.text}
      </a>
    );
  }
  if (span.strong) {
    return (
      <span key={key} className="font-medium text-app-ink">
        {span.text}
      </span>
    );
  }
  return <span key={key}>{span.text}</span>;
}

/**
 * بلوکِ صفحهٔ محتوایی در صفحه‌ساز.
 *
 * `title` از عنوانِ صفحهٔ CMS می‌آید (پاس‌شده از رندرر) — یعنی `h1` همان چیزی
 * است که مدیر در سربرگ صفحه می‌بیند، دقیقاً مثل سایت که `h1` از عنوانِ صفحه
 * می‌آید. بقیهٔ ساختار از props همین بلوک می‌آید.
 */
export function ContentPageBlock({ block, data, pageTitle }: CmsBlockProps) {
  const p = block.props;
  const rows = pItems(p, "sections");
  return (
    <ContentPageView
      title={pageTitle ?? ""}
      intro={pStr(p, "intro")}
      updated={pStr(p, "updated")}
      sections={rows.map((r) => ({ title: r.title, body: r.body }))}
    />
  );
}
