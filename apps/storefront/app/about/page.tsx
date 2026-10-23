import type { Metadata } from "next";
import { SiteContentView } from "@/components/layout/SiteContentView";
import CmsSlot from "@/components/cms/CmsSlot";
import { contentPageMetadata } from "@/lib/cms";
import { COPY } from "@/lib/copy";
import { ABOUT_CONTENT } from "@ghasedak/contracts";

/** مسیر زنده است تا صفحه‌ساز بتواند محتوایش را جایگزین کند */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return contentPageMetadata({
    slug: "about",
    title: COPY.legal.about,
    description: "لباس زیر قاصدک چیست و چرا سه شعبه در خیابان عبدالمطلب دارد؟",
  });
}

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
