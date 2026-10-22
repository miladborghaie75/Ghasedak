import { meta } from "@/components/layout/LegalShell";
import { SiteContentView } from "@/components/layout/SiteContentView";
import CmsSlot from "@/components/cms/CmsSlot";
import { site } from "@/lib/site";
import { COPY } from "@/lib/copy";
import { RETURNS_CONTENT } from "@ghasedak/contracts";

export const metadata = meta(
  `${COPY.legal.returns} — ${site.fullName}`,
  "شرایط بازگشت کالای لباس زیر قاصدک: مهلت ۷ روز، کالای سالم و بدون لکه با مارک کنده‌نشده.",
);

/** مسیر زنده است تا صفحه‌ساز بتواند محتوایش را جایگزین کند */
export const dynamic = "force-dynamic";

export default function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <CmsSlot
      slug="returns"
      searchParams={searchParams}
      fallback={<SiteContentView content={RETURNS_CONTENT} title={COPY.legal.returns} />}
    />
  );
}
