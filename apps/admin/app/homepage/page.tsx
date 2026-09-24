import type { Metadata } from "next";
import PageShell from "@/components/PageShell";
import HomepageClient from "./HomepageClient";

export const metadata: Metadata = { title: "صفحه‌ساز — قاصدک" };

/** صفحه‌ساز بلوک‌های صفحه اصلی */
export default async function HomepagePage() {
  return (
    <PageShell title="صفحه‌ساز صفحه اصلی" subtitle="ترتیب و محتوای بلوک‌های صفحه اصلی فروشگاه" permission="marketing.view">
      <HomepageClient />
    </PageShell>
  );
}
