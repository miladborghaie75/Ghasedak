import type { Metadata } from "next";
import { Suspense } from "react";
import { NeedFinder } from "@/components/commerce/NeedFinder";

export const metadata: Metadata = {
  title: "چی لازم داری؟ — راهنمای انتخاب",
  description: "سه سؤال کوتاه، پیشنهادهای منطبق با نیازت — با دلیل انطباق.",
};

/**
 * صفحه نیاز (بند ۹): ویزارد سه‌گام + نتیجه با دلیل.
 * ?start=sport → گام ۱ از قبل انتخاب شده.
 */
export default async function NeedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <div className="mx-auto max-w-4xl px-3 py-8 sm:px-4">
      <h1 className="text-center font-display text-3xl text-plum">چی لازم داری؟</h1>
      <Suspense fallback={<p className="py-16 text-center text-sm text-muted">در حال آماده‌سازی…</p>}>
        <NeedFinderWithParams searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function NeedFinderWithParams({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const start = typeof sp.start === "string" ? sp.start : undefined;
  return <NeedFinder initialSituation={start} />;
}
