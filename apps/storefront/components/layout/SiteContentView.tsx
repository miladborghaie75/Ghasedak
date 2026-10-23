import { ContentPageView } from "@ghasedak/blocks";
import { sectionToBody, type SiteContentPage } from "@ghasedak/contracts";

/**
 * چیدمانِ پیش‌فرضِ صفحه‌های محتوایی/قانونی — از روی **محتوای مشترک**.
 *
 * این کامپوننت دیگر چیدمانی ندارد؛ فقط مدلِ غنیِ محتوا را به مدلِ مشترکِ
 * `ContentPageView` (همان چیزی که بلوک `CONTENT_PAGE` در صفحه‌ساز رندر می‌کند)
 * تبدیل می‌کند. یعنی صفحهٔ ایستا و صفحهٔ صفحه‌ساز از **یک کد** رندر می‌شوند
 * و «صفحهٔ درباره ما در پنل با سایت فرق دارد» از نظر ساختاری ناممکن است.
 */
export function SiteContentView({
  content,
  title,
}: {
  content: SiteContentPage;
  title: string;
}) {
  return (
    <ContentPageView
      title={title}
      intro={content.intro}
      updated={content.updated}
      sections={content.sections.map((section) => ({
        title: section.title ?? "",
        body: sectionToBody(section),
      }))}
    />
  );
}
