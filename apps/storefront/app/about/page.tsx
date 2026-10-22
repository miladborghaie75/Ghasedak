import { meta } from "@/components/layout/LegalShell";
import { SiteContentView } from "@/components/layout/SiteContentView";
import CmsSlot from "@/components/cms/CmsSlot";
import { site } from "@/lib/site";
import { COPY } from "@/lib/copy";
import { ABOUT_CONTENT } from "@ghasedak/contracts";

export const metadata = meta(
  `${COPY.legal.about} — ${site.fullName}`,
  "لباس زیر قاصدک چیست و چرا سه شعبه در خیابان عبدالمطلب دارد؟",
);

/** مسیر زنده است تا صفحه‌ساز بتواند محتوایش را جایگزین کند */
export const dynamic = "force-dynamic";

export default function AboutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <CmsSlot
      slug="about"
      searchParams={searchParams}
      fallback={<SiteContentView content={ABOUT_CONTENT} title={COPY.legal.about} />}
    />
  );
}
