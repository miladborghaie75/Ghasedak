import { ContentPageView } from "@ghasedak/blocks";
import { sectionToBody, type SiteContentPage } from "@ghasedak/contracts";
import { loadLiveContentNav } from "@/lib/cms";

/**
 * چیدمانِ پیش‌فرضِ صفحه‌های محتوایی/قانونی — از روی **محتوای مشترک**.
 *
 * این کامپوننت دیگر چیدمانی ندارد؛ فقط مدلِ غنیِ محتوا را به مدلِ مشترکِ
 * `ContentPageView` (همان چیزی که بلوک `CONTENT_PAGE` در صفحه‌ساز رندر می‌کند)
 * تبدیل می‌کند. یعنی صفحهٔ ایستا و صفحهٔ صفحه‌ساز از **یک کد** رندر می‌شوند
 * و «صفحهٔ درباره ما در پنل با سایت فرق دارد» از نظر ساختاری ناممکن است.
 */
export async function SiteContentView({
  content,
  title,
}: {
  content: SiteContentPage;
  title: string;
}) {
  // ناوبری از تنظیمِ پنل می‌آید تا همین چیدمانِ ایستا هم نوارِ به‌روز داشته
  // باشد (غایب یعنی تنظیمی نیست → پیش‌فرضِ قرارداد).
  const nav = await loadLiveContentNav();
  return (
    <ContentPageView
      title={title}
      nav={nav ?? undefined}
      intro={content.intro}
      updated={content.updated}
      sections={content.sections.map((section) => ({
        title: section.title ?? "",
        body: sectionToBody(section),
      }))}
    />
  );
}
