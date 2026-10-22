import { meta } from "@/components/layout/LegalShell";
import { SiteContentView } from "@/components/layout/SiteContentView";
import CmsSlot from "@/components/cms/CmsSlot";
import { site } from "@/lib/site";
import { COPY } from "@/lib/copy";
import { TERMS_CONTENT } from "@ghasedak/contracts";

export const metadata = meta(
  `${COPY.legal.terms} — ${site.fullName}`,
  "شرایط استفاده از فروشگاه اینترنتی لباس زیر قاصدک: ثبت سفارش، پرداخت، قیمت‌ها و بازگشت کالا.",
);

/** مسیر زنده است تا صفحه‌ساز بتواند محتوایش را جایگزین کند */
export const dynamic = "force-dynamic";

export default function TermsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <CmsSlot
      slug="terms"
      searchParams={searchParams}
      fallback={<SiteContentView content={TERMS_CONTENT} title={COPY.legal.terms} />}
    />
  );
}
