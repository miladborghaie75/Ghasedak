import PageShell from "@/components/PageShell";
import CategoriesClient from "./clients/CategoriesClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <PageShell permission="categories.view" title="دسته‌ها">
      <CategoriesClient />
    </PageShell>
  );
}
