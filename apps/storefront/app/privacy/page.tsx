import type { Metadata } from "next";
import { SiteContentView } from "@/components/layout/SiteContentView";
import CmsSlot from "@/components/cms/CmsSlot";
import { contentPageMetadata } from "@/lib/cms";
import { COPY } from "@/lib/copy";
import { PRIVACY_CONTENT } from "@ghasedak/contracts";

/** مسیر زنده است تا صفحه‌ساز بتواند محتوایش را جایگزین کند */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return contentPageMetadata({
    slug: "privacy",
    title: COPY.legal.privacy,
    description: "نحوه جمع‌آوری، استفاده و نگهداری اطلاعات شخصی مشتریان لباس زیر قاصدک.",
  });
}

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
