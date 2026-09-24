"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { faNum } from "@/lib/format";

/**
 * راهنمای سایز — در PDP به‌صورت لینک داخل متن، در PLP هم قابل استفاده.
 */
export function SizeGuideButton({ label = "راهنمای سایز" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 font-bold text-primary-strong underline decoration-primary/40 underline-offset-4 hover:decoration-primary-strong"
      >
        {label}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="راهنمای سایز">
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="mb-2 text-sm font-extrabold text-ink">چطور اندازه بگیریم؟</h3>
            <ol className="list-inside list-decimal space-y-1.5 text-[13px] leading-7 text-muted">
              <li>متر را صاف و بدون کشیدگی، دور زیر سینه بگیرید (فنر).</li>
              <li>متر را دور پرترین قسمت سینه بگیرید (کاپ).</li>
              <li>متر موازی زمین بماند و نفس عادی بکشید.</li>
            </ol>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-center text-[13px]">
              <caption className="sr-only">جدول تبدیل سایز سوتین</caption>
              <thead>
                <tr className="border-b border-line text-[12px] text-muted">
                  <th scope="col" className="py-2 font-bold">زیر سینه (سانت)</th>
                  <th scope="col" className="py-2 font-bold">فنر</th>
                  <th scope="col" className="py-2 font-bold">سایز استاندارد</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[
                  { cm: "۶۸ تا ۷۲", band: "۷۰", size: "S" },
                  { cm: "۷۳ تا ۷۷", band: "۷۵", size: "M" },
                  { cm: "۷۸ تا ۸۲", band: "۸۰", size: "L" },
                  { cm: "۸۳ تا ۸۷", band: "۸۵", size: "XL" },
                  { cm: "۸۸ تا ۹۲", band: "۹۰", size: "XXL" },
                ].map((r) => (
                  <tr key={r.band}>
                    <td className="py-2.5 text-ink tnum">{r.cm}</td>
                    <td className="py-2.5 font-bold text-ink tnum">{r.band}</td>
                    <td className="py-2.5 text-ink">{r.size}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="rounded-xl bg-primary-tint p-3 text-[12px] leading-6 text-muted">
            بین دو سایز گیر کردید؟ سایز بزرگ‌تر فنر و کاپ کوچک‌تر معمولاً راحت‌تر است.
          </p>
        </div>
      </Sheet>
    </>
  );
}
