import type { Metadata } from "next";
import { SiteContentView } from "@/components/layout/SiteContentView";
import CmsSlot from "@/components/cms/CmsSlot";
import { contentPageMetadata } from "@/lib/cms";
import { COPY } from "@/lib/copy";
import { TERMS_CONTENT } from "@ghasedak/contracts";

/** مسیر زنده است تا صفحه‌ساز بتواند محتوایش را جایگزین کند */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return contentPageMetadata({
    slug: "terms",
    title: COPY.legal.terms,
    description:
      "شرایط استفاده از فروشگاه اینترنتی لباس زیر قاصدک: ثبت سفارش، پرداخت، قیمت‌ها و بازگشت کالا.",
  });
}

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
