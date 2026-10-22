import { meta } from "@/components/layout/LegalShell";
import { SiteContentView } from "@/components/layout/SiteContentView";
import CmsSlot from "@/components/cms/CmsSlot";
import { site } from "@/lib/site";
import { COPY } from "@/lib/copy";
import { PRIVACY_CONTENT } from "@ghasedak/contracts";

export const metadata = meta(
  `${COPY.legal.privacy} — ${site.fullName}`,
  "نحوه جمع‌آوری، استفاده و نگهداری اطلاعات شخصی مشتریان لباس زیر قاصدک.",
);

/** مسیر زنده است تا صفحه‌ساز بتواند محتوایش را جایگزین کند */
export const dynamic = "force-dynamic";

export default function PrivacyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <CmsSlot
      slug="privacy"
      searchParams={searchParams}
      fallback={<SiteContentView content={PRIVACY_CONTENT} title={COPY.legal.privacy} />}
    />
  );
}
