import PageShell from "@/components/PageShell";
import PhotographyClient from "./clients/PhotographyClient";

export const dynamic = "force-dynamic";

/**
 * برنامهٔ عکاسی محصول (گام ۲۰) — تابلوی پیشرفت، شات‌لیستِ هر دسته و تأییدِ عکس.
 *
 * الگوی server page + client؛ خواندن با products.view و نوشتن با products.update
 * (تأییدِ عکس در عمل تصویرِ محصول را عوض می‌کند، پس همان مجوزِ ویرایشِ محصول را می‌خواهد).
 */
export default function Page() {
  return (
    <PageShell
      permission="products.view"
      title="برنامهٔ عکاسی محصول"
      subtitle="کادرهای لازمِ هر دسته، وضعیتِ هر محصول و تأییدِ عکس‌ها. با تأییدِ «نمای صافِ جلو»، همان عکس عکسِ اصلیِ محصول می‌شود و آرتِ جانشین از سایت کنار می‌رود."
    >
      <PhotographyClient />
    </PageShell>
  );
}
