import { meta } from "@/components/layout/LegalShell";
import { SiteContentView } from "@/components/layout/SiteContentView";
import CmsSlot from "@/components/cms/CmsSlot";
import { site } from "@/lib/site";
import { COPY } from "@/lib/copy";
import { SHIPPING_CONTENT } from "@ghasedak/contracts";

export const metadata = meta(
  `${COPY.legal.shipping} — ${site.fullName}`,
  "ارسال سریع پستی، تحویل حضوری از سه شعبه قاصدک و نحوه پیگیری سفارش.",
);

/** مسیر زنده است تا صفحه‌ساز بتواند محتوایش را جایگزین کند */
export const dynamic = "force-dynamic";

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
