"use client";

import nextDynamic from "next/dynamic";
import type { ShippingMethodDTO } from "./CheckoutClient";

/**
 * گام ۲۱ (کارایی) — لود تنبل فرم تکمیل خرید.
 *
 * `ssr: false` داخل Server Component ممنوع است؛ این wrapper کلاینت، چانک سنگین
 * چک‌اوت را از بار اولیهٔ صفحه بیرون می‌آورد. برای CLS، اسکلت با ارتفاع حداقلی
 * نگه داشته می‌شود تا فرم سر جایش بنشیند.
 */
const CheckoutClient = nextDynamic(
  () => import("./CheckoutClient").then((m) => ({ default: m.CheckoutClient })),
  { ssr: false, loading: () => <div className="min-h-96" aria-hidden /> },
);

export function CheckoutClientLazy({ methods }: { methods: ShippingMethodDTO[] }) {
  return <CheckoutClient methods={methods} />;
}
