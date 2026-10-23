import type { Metadata } from "next";
import { SiteContentView } from "@/components/layout/SiteContentView";
import CmsSlot from "@/components/cms/CmsSlot";
import { contentPageMetadata } from "@/lib/cms";
import { COPY } from "@/lib/copy";
import { SHIPPING_CONTENT } from "@ghasedak/contracts";

/** مسیر زنده است تا صفحه‌ساز بتواند محتوایش را جایگزین کند */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return contentPageMetadata({
    slug: "shipping",
    title: COPY.legal.shipping,
    description: "ارسال سریع پستی، تحویل حضوری از سه شعبه قاصدک و نحوه پیگیری سفارش.",
  });
}

export default function ShippingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <CmsSlot
      slug="shipping"
      searchParams={searchParams}
      fallback={<SiteContentView content={SHIPPING_CONTENT} title={COPY.legal.shipping} />}
    />
  );
}
