import type { Metadata } from "next";
import PageShell from "@/components/PageShell";
import MediaLibrary from "./MediaClient";

export const metadata: Metadata = { title: "رسانه — قاصدک" };

/** کتابخانه رسانه — آپلود واقعی (بند ۳۵) */
export default async function MediaPage() {
  return (
    <PageShell title="رسانه" subtitle="آپلود و مدیریت تصاویر محصول، برند و دسته" permission="media.view">
      <MediaLibrary />
    </PageShell>
  );
}
