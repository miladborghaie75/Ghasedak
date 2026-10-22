import { meta } from "@/components/layout/LegalShell";
import { SiteContentView } from "@/components/layout/SiteContentView";
import CmsSlot from "@/components/cms/CmsSlot";
import { site } from "@/lib/site";
import { COPY } from "@/lib/copy";
import { CONTACT_CONTENT } from "@ghasedak/contracts";

export const metadata = meta(
  `${COPY.legal.contact} — ${site.fullName}`,
  "راه‌های ارتباط با لباس زیر قاصدک: شماره تماس، سه شعبه در خیابان عبدالمطلب و صفحه اینستاگرام.",
);

/** مسیر زنده است تا صفحه‌ساز بتواند محتوایش را جایگزین کند */
export const dynamic = "force-dynamic";

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
