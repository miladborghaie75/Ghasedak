import type { Metadata } from "next";
import { NeedFinder } from "@/components/commerce/NeedFinder";
import { loadNeedFinderSteps } from "@/lib/needs";

export const metadata: Metadata = {
  title: "چی لازم داری؟ — راهنمای انتخاب",
  description: "سه سؤال کوتاه، پیشنهادهای منطبق با نیازت — با دلیل انطباق.",
  alternates: { canonical: "/need" },
};

/**
 * صفحه نیاز (بند ۹): ویزارد سه‌گام — گام‌ها از دیتابیس (API).
 * ?start=sport → گام ۱ از قبل انتخاب شده. نتیجه در /need/result (URL اشتراک‌پذیر).
 */
export default async function NeedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [sp, steps] = await Promise.all([searchParams, loadNeedFinderSteps()]);
  const start = typeof sp.start === "string" ? sp.start : undefined;

  return (
    <div className="mx-auto max-w-4xl px-3 py-8 sm:px-4">
      <h1 className="text-center font-display text-3xl text-plum">چی لازم داری؟</h1>
      <NeedFinder steps={steps} initialSituation={start} />
    </div>
  );
}
