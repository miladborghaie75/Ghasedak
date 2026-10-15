import { faNum } from "@/lib/format";
import type { ReviewsData } from "@/lib/reviews";
import { ReviewForm } from "./ReviewForm";

/**
 * بخش نظرات محصول (گام ۱۱ — بند ۴۱/۱۰۷):
 *  - خلاصهٔ امتیاز روی «همهٔ» نظرات تأییدشده (API حساب می‌کند)
 *  - فقط نظرات APPROVED؛ بدون PII
 *  - حجم معقول: هیچ تب/مودال سنگینی نیست — کارت + لیست + فرم تاشو
 *  - داده در دسترس نبود → پیام صادقانه، نه ادعای «نظری نیست» (بند ۸۸)
 */
export function ReviewsSection({ slug, data }: { slug: string; data: ReviewsData | null }) {
  const summary = data?.summary ?? null;
  const items = data?.items ?? [];

  return (
    <section aria-label="نظرات مشتریان" className="mt-10">
      <div className="mb-4 flex flex-wrap items-baseline gap-2">
        <h2 className="text-lg font-extrabold text-ink">نظر مشتری‌ها</h2>
        {summary && summary.count > 0 ? (
          <span className="text-[12px] text-muted">
            {faNum(summary.count)} نظر · میانگین {faNum(summary.avg ?? 0)} از ۵
          </span>
        ) : null}
      </div>

      {data === null ? (
        <p className="rounded-card border border-line bg-surface px-4 py-6 text-center text-[13px] text-muted">
          نظرها الان قابل نمایش نیستند؛ کمی بعد دوباره سر بزن.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* خلاصهٔ امتیاز */}
          <div className="rounded-card border border-line bg-surface p-4 shadow-clay-1 lg:col-span-1">
            {summary && summary.count > 0 ? (
              <>
                <p className="text-3xl font-black text-ink">
                  {faNum(summary.avg ?? 0)}
                  <span className="text-base font-bold text-muted"> / ۵</span>
                </p>
                <p className="mt-1 text-amber-500" aria-hidden>
                  {"★".repeat(Math.round(summary.avg ?? 0))}
                  <span className="text-line">{"★".repeat(5 - Math.round(summary.avg ?? 0))}</span>
                </p>
                <ul className="mt-3 flex flex-col gap-1.5">
                  {[5, 4, 3, 2, 1].map((s) => {
                    const c = summary.stars[s - 1] ?? 0;
                    const pct = summary.count > 0 ? Math.round((c / summary.count) * 100) : 0;
                    return (
                      <li key={s} className="flex items-center gap-2 text-[11px] text-muted">
                        <span className="w-3 text-center">{faNum(s)}</span>
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                          <span className="block h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
                        </span>
                        <span className="w-6 text-end tabular-nums">{faNum(c)}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <p className="text-[13px] leading-7 text-muted">
                هنوز نظری برای این محصول منتشر نشده؛ اولین نفر باش.
              </p>
            )}
          </div>

          {/* لیست نظرات */}
          <div className="flex flex-col gap-3 lg:col-span-2">
            {items.length === 0 ? (
              <p className="rounded-card border border-line bg-surface px-4 py-6 text-center text-[13px] text-muted">
                هنوز نظری منتشر نشده است.
              </p>
            ) : (
              items.map((r) => (
                <article key={r.id} className="rounded-card border border-line bg-surface p-4 shadow-clay-1">
                  <div className="flex flex-wrap items-center gap-2 text-[12px]">
                    <span className="text-amber-500" aria-label={`امتیاز ${faNum(r.rating)} از ۵`}>
                      {"★".repeat(r.rating)}
                      <span className="text-line">{"★".repeat(5 - r.rating)}</span>
                    </span>
                    <span className="font-bold text-ink">{r.name}</span>
                    {r.isVerifiedPurchase ? (
                      <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-bold text-primary-strong">
                        خریدار واقعی
                      </span>
                    ) : null}
                    <span className="text-muted">{new Date(r.createdAt).toLocaleDateString("fa-IR")}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-[13px] leading-7 text-ink">{r.body}</p>
                  {r.adminReply ? (
                    <p className="mt-2 rounded-card bg-primary-tint/60 px-3 py-2 text-[12px] leading-6 text-ink">
                      <span className="font-bold">پاسخ قاصدک: </span>
                      {r.adminReply}
                    </p>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </div>
      )}

      {/* فرم ثبت — همیشه پایین بخش، بعد از نظرات منتشرشده */}
      <div className="mt-4">
        <ReviewForm slug={slug} />
      </div>
    </section>
  );
}
