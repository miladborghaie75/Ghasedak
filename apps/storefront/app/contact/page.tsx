import type { Metadata } from "next";
import { SiteContentView } from "@/components/layout/SiteContentView";
import CmsSlot from "@/components/cms/CmsSlot";
import { contentPageMetadata } from "@/lib/cms";
import { COPY } from "@/lib/copy";
import { CONTACT_CONTENT } from "@ghasedak/contracts";

/** مسیر زنده است تا صفحه‌ساز بتواند محتوایش را جایگزین کند */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return contentPageMetadata({
    slug: "contact",
    title: COPY.legal.contact,
    description:
      "راه‌های ارتباط با لباس زیر قاصدک: شماره تماس، سه شعبه در خیابان عبدالمطلب و صفحه اینستاگرام.",
  });
}

export default function ContactPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <CmsSlot
      slug="contact"
      searchParams={searchParams}
      fallback={<SiteContentView content={CONTACT_CONTENT} title={COPY.legal.contact} />}
    />
  );
}
