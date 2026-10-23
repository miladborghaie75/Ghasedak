import type { Metadata } from "next";
import { SiteContentView } from "@/components/layout/SiteContentView";
import CmsSlot from "@/components/cms/CmsSlot";
import { contentPageMetadata } from "@/lib/cms";
import { COPY } from "@/lib/copy";
import { RETURNS_CONTENT } from "@ghasedak/contracts";

/** مسیر زنده است تا صفحه‌ساز بتواند محتوایش را جایگزین کند */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return contentPageMetadata({
    slug: "returns",
    title: COPY.legal.returns,
    description:
      "شرایط بازگشت کالای لباس زیر قاصدک: مهلت ۷ روز، کالای سالم و بدون لکه با مارک کنده‌نشده.",
  });
}

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
