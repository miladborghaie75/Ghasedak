import PageShell from "@/components/PageShell";
import JournalPrintClient from "./print-client";
import { can } from "@/lib/session";
import { getIdentity } from "@/lib/session.server";

export const dynamic = "force-dynamic";

/**
 * چاپ سند حسابداری — صفحهٔ مستقل.
 *
 * جدا بودنش از صفحهٔ اسناد عمدی است: خروجی چاپ باید فقط خودِ سند باشد،
 * نه همراه با نوار فیلتر و جدول‌ها. اگر چاپ داخل صفحهٔ اسناد گرفته شود،
 * آن‌ها هم وارد PDF می‌شوند.
 */
export default async function JournalPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getIdentity();
  if (!me || !can(me.permissions, "accounting.view")) {
    return (
      <PageShell permission="accounting.view" title="چاپ سند">
        <p className="text-sm text-app-err">برای دیدن سند با دسترسی حسابداری وارد شو.</p>
      </PageShell>
    );
  }

  return (
    <PageShell permission="accounting.view" title="چاپ سند حسابداری">
      <JournalPrintClient id={id} />
    </PageShell>
  );
}